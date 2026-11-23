import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts import align_lyrics
from scripts.align_lyrics import restore_qwen_words


def item(text, start, end):
    return {"text": text, "start_time": start, "end_time": end}


class QwenLyricsAlignmentTest(unittest.TestCase):
    def test_preserves_reference_and_merges_characters(self):
        reference = ["Don’t", "愛你!", "/", "now."]
        result = restore_qwen_words(reference, [
            item("Don't", 1.0, 1.4), item("愛", 2.0, 2.2), item("你", 2.3, 2.6), item("now", 3.0, 3.2),
        ], 4.0)
        self.assertEqual([word["word"] for word in result], reference)
        self.assertEqual([(result[i]["start"], result[i]["end"]) for i in (0, 1, 3)], [
            (1.0, 1.4), (2.0, 2.6), (3.0, 3.2),
        ])
        self.assertGreater(result[2]["end"], result[2]["start"])

    def test_splits_tokens_at_supplied_boundaries(self):
        result = restore_qwen_words(["one", "two"], [item("onetwo", 1.0, 3.0)], 4.0)
        self.assertEqual([(word["start"], word["end"]) for word in result], [(1.0, 2.0), (2.0, 3.0)])

    def test_handles_timestamp_clock_rounding_at_end_of_audio(self):
        result = restore_qwen_words(["yes"], [item("yes", 1.04, 1.04)], 1.0)
        self.assertGreater(result[0]["end"], result[0]["start"])
        self.assertEqual(result[0]["end"], 1.0)

    def test_refuses_mismatch_or_invalid_timestamps(self):
        with self.assertRaisesRegex(ValueError, "could not match"):
            restore_qwen_words(["don't", "change"], [item("do", 0.0, 1.0), item("change", 1.0, 2.0)], 2.0)
        with self.assertRaisesRegex(ValueError, "invalid timestamps"):
            restore_qwen_words(["no"], [item("no", 1.0, 0.0)], 2.0)

    def test_punctuation_and_occasional_zero_length_words_do_not_trigger_replacement_guard(self):
        result = restore_qwen_words(["one", "-", "two", "…", "three"], [
            item("one", 0.1, 0.1), item("two", 0.2, 0.2), item("three", 0.3, 0.5),
        ], 1.0)
        self.assertEqual(len(result), 5)

    def test_collapsed_lexical_spans_do_not_replace_existing_output(self):
        def collapsed(*_):
            return restore_qwen_words(["one", "two", "three", "four"], [
                item("one", 0.1, 0.1), item("two", 0.2, 0.2), item("three", 0.3, 0.3), item("four", 0.4, 0.5),
            ], 1.0)

        with TemporaryDirectory() as directory:
            source = Path(directory) / "lyrics.json"
            source.write_text('{"lyrics":["one two three four"]}', encoding="utf-8")
            output = Path(directory) / "aligned.json"
            output.write_text("original timings", encoding="utf-8")
            args = ["align_lyrics.py", "--engine", "qwen", "--language", "en", "--audio", "test.wav",
                    "--input", str(source), "--output", str(output)]
            with (patch.object(align_lyrics.sys, "argv", args), patch.object(align_lyrics.sys, "version_info", (3, 13)),
                  patch.object(align_lyrics, "decode_audio", return_value=range(16000)),
                  patch.object(align_lyrics, "align_qwen", side_effect=collapsed)):
                with self.assertRaisesRegex(ValueError, "collapsed timings for 3 of 4 words"):
                    align_lyrics.main()
            self.assertEqual(output.read_text(encoding="utf-8"), "original timings")
