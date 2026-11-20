# Studio project recovery

Studio keeps a local recovery draft for the active desktop editing session. It includes project metadata, stem settings and paths, the backdrop, saved cue edits, and lyric text that still needs to be turned into cues.

When Studio starts, **Project Recovery** offers drafts from earlier sessions. Choose **Restore** to bring a draft back into the editor. **Close** keeps drafts available under **Recovery drafts** in the footer. Use **Discard** to delete an individual draft.

Use **Save Project** to write the recovered edits to the project file. For a new project, Studio opens a save dialog. For an existing project, Studio checks the original revision. If the file changed outside the editor, use **Save As** to preserve the recovered edits in a separate project. Build cues from any pending lyric text before saving.

The recovery draft stores references to the original media. If a stem or backdrop has moved, Studio restores the edits and reports the unavailable assets. Return the media to its original location or replace it in the editor.

Studio writes the newest draft after a short delay and flushes pending writes on an orderly close. Power loss or a forced termination can lose the most recent edits. Recovery drafts are stored in the desktop app's profile, and a successful project save clears the draft for those edits.
