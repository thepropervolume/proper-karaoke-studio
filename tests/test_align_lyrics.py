import unittest
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts import align_lyrics
from scripts.align_lyrics import restore_qwen_words


def item(text, start, end):
    return {"text": text, "start_time": start, "end_time": end}


class QwenLyricsAlignmentTest(unittest.TestCase):
    def test_qwen_decode_chooses_best_timestamp_inside_audio(self):
        class FixtureLogits:
            def __getitem__(self, key):
                self_index, classes = key
                assert self_index is Ellipsis
                # The highest-scoring end class is 400 ms. Only the first four
                # classes cover a 200 ms clip, including the rounded 240 ms end.
                return [[0, 2, 0, 0, 0, 0][classes], [0, 0, 1, 2, 0, 3][classes]]

        class Inputs(dict):
            def to(self, *_):
                return self

        def decode(logits, input_ids, word_lists, timestamp_token_id, timestamp_segment_time):
            self.assertEqual(timestamp_segment_time, 80)
            self.assertEqual(timestamp_token_id, 17)
            start, end = [row.index(max(row)) * timestamp_segment_time / 1000 for row in logits]
            return [[item(word_lists[0][0], start, end)]]

        processor = SimpleNamespace(
            prepare_forced_aligner_inputs=lambda **_: (Inputs(input_ids=[17, 17]), [["now"]]),
            decode_forced_alignment=decode,
        )
        model = Mock(device="cpu", dtype="float32", config=SimpleNamespace(timestamp_segment_time=80, timestamp_token_id=17))
        model.to.return_value = model
        model.return_value = SimpleNamespace(logits=FixtureLogits())
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False), float32="float32", inference_mode=nullcontext)
        transformers = SimpleNamespace(AutoModelForTokenClassification=Mock(), AutoProcessor=Mock())
        transformers.AutoModelForTokenClassification.from_pretrained.return_value = model
        transformers.AutoProcessor.from_pretrained.return_value = processor
        with patch.dict(align_lyrics.sys.modules, {"torch": torch, "transformers": transformers}):
            self.assertEqual(align_lyrics.align_qwen(range(3200), ["Now!"], "en", 0.2),
                             [{"word": "Now!", "start": 0.08, "end": 0.2}])

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


class WhisperXLyricsAlignmentTest(unittest.TestCase):
    def test_uses_installed_tokenizer_and_leaves_other_resources_to_nltk(self):
        tokenizer = object()
        load = Mock(return_value="other resource")
        punkt = Mock(return_value=tokenizer)
        adapted = align_lyrics.whisperx_sentence_loader(load, punkt)
        self.assertIs(adapted("tokenizers/punkt_tab/french.pickle"), tokenizer)
        punkt.assert_called_once_with("french")
        self.assertEqual(adapted("an unrelated resource"), "other resource")
        load.assert_called_once_with("an unrelated resource")

    def test_aligns_supplied_transcript_without_downloading_missing_or_unsafe_punkt(self):
        original_loader = Mock()
        model = object()
        metadata = {"language": "en"}

        def align(transcript, actual_model, actual_metadata, audio, device, return_char_alignments):
            self.assertEqual(transcript, [{"start": 0.0, "end": 2.0, "text": "Keep. My line."}])
            self.assertIs(actual_model, model)
            self.assertEqual(actual_metadata, metadata)
            self.assertEqual(device, "cpu")
            self.assertFalse(return_char_alignments)
            splitter = whisperx.nltk_load("tokenizers/punkt_tab/english.pickle")
            self.assertEqual(splitter.span_tokenize(transcript[0]["text"]), [(0, 14)])
            return {"segments": [{"words": [{"word": "Keep.", "start": 0.1, "end": 0.5}]}]}

        whisperx = SimpleNamespace(nltk_load=original_loader, load_align_model=Mock(return_value=(model, metadata)), align=align)
        for error in (LookupError("missing tokenization data"), PermissionError("shared directory")):
            with self.subTest(error=error):
                punkt = Mock(side_effect=error)
                modules = {
                    "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
                    "nltk.tokenize": SimpleNamespace(PunktTokenizer=punkt),
                    "whisperx": SimpleNamespace(alignment=whisperx),
                }
                with patch.dict(align_lyrics.sys.modules, modules):
                    self.assertEqual(align_lyrics.align_whisperx(range(32000), ["Keep.", "My line."], "en", 2.0),
                                     [{"word": "Keep.", "start": 0.1, "end": 0.5}])
                punkt.assert_called_once_with("english")
                self.assertIs(whisperx.nltk_load, original_loader)
        original_loader.assert_not_called()
