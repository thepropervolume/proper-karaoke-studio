# Studio workspace

Studio uses Booth’s navigation rail, application mark, appearance colors, and playback controls. The singer preview stays in the center while the right panel changes between **Audio Stems**, **Lyrics**, and **Export**. The bottom transport keeps playback position, volume, and the waveform in the same place.

- Import or record audio in **Audio Stems**. Change a stem’s role, voice label, and volume in its card.
- Use **Lyrics** to import a file or paste text into **Lyrics Text**. When a JSON search result has several lyric versions, pick the recording that matches your audio. Set the minimum, target, and maximum characters per line, then use **Format Lyrics** to reflow the draft. The defaults are 10, 19, and 26 characters. **Build Cues** asks before replacing existing timings. Choose the audio for **AI Sync**, or time lines and words manually. Each row contains the lyric and its start/end values. Expand **Word timings** to edit individual words.
- Type `per/fect` in a lyric row or draft to time `per` and `fect` separately. Singers see `perfect`. Type `\/` for a slash that singers should see. When a word already has timing, adding a split estimates the new boundary inside that word and keeps its neighbors in place. For a line with no word timings, use **Split Line into Word Timings**, **Time Words**, or **AI Sync**.
- Click a lyric block below the waveform to seek there and open that row in the cue sheet with its word timings expanded. You can also use the waveform’s **Lyric cue** picker with the keyboard.
- Select a cue on the waveform or from the waveform selector. Seek to the new position and select **Move to playhead** to shift that cue with its existing word offsets. Drag the waveform’s top edge to adjust its height. Ctrl+click or Ctrl+scroll zooms at the pointer, Ctrl+Shift+click zooms out, and the scroll wheel pans once zoomed in. The transport buttons skip back 5 seconds and forward 10 seconds.
- **Time Lines** and **Time Words** start at the current playhead. Use **Undo** and **Redo** to step through taps. **Cancel Timing** restores all prior timings, and **Finish Timing** keeps the captures. Right-click a timing input to use **Set to Current Position** or the standard editing commands. Select a line without timed words and choose **Split Line into Word Timings** to divide its duration equally. If Studio cannot infer the duration, its word timing fields stay blank until you supply them.
- Open **Lyric Appearance** beside the singer preview or in **View**. Use **Lines on Screen** to set two to six rows. New projects start with four. Projects saved with one row open with two. You can choose a bundled font or import a TrueType or OpenType file with **Add Font**, then set its size, line height, casing, and colors. A finished lyric normally starts fading halfway through the next sung line, and the next lyric for its row then fades in. Rows clear for instrumental breaks and make space for their next sung cue. The preview and authored MP4 and CD+G exports use the same timing.
- Enable the **Song Progress Bar** or **Countdown Bar** in Lyric Appearance to set its size, position, and colors. The song bar fills throughout playback. The countdown fills during the intro or a break that meets the minimum duration, then clears ahead of the next lyrics.
- Use **Choose Backdrop** in Lyric Appearance or the image button beside the preview to pick a PNG, JPEG, GIF, or MP4. GIFs and MP4s follow playback and seeking, with **Loop** enabled by default. When a backdrop finishes with looping off, the selected background color fills the remaining time. Studio mutes the backdrop in the preview and MP4 export. Projects and TPV kits retain visual settings and selected assets. LRC, SRT, and lyric JSON keep the original text.
- Use **File** to open, save, or export a project. **File → Export As** offers MP4, TPV kit, lyric files, authored CD+G, and the original CD+G when it is attached. Open **Edit → Preferences** for workflows and integrations. **Window → Toggle Full Screen** fills the display.

In **Preferences**, **Save Session Settings** applies changes until Studio closes. Open its caret menu and choose **Save as Default Settings** to reuse them at the next launch. Individual Reset buttons restore saved defaults. Use **Restore Factory Settings** to bring back the shipped values, then choose a save scope.

Use **Help → Documentation** to open the bundled guides. **Help → Keyboard Shortcuts** opens the preferences for assigning shortcuts and opening the JSON files. [Keyboard shortcut guide](keyboard-shortcuts.md)

Use **Help → Check for Updates** to check immediately. Choose and save the startup behavior in **Preferences → Updates**. A verified installer can wait until you quit. [Studio updates](releases.md#update-studio)

Drag the divider beside the inspector to resize it. When focused, the divider also accepts the Left and Right arrows. Double-click to restore the default width. Set the app's Day or Night theme and blue, pink, or purple accent from **View** or the toolbar palette. Studio remembers the selected app appearance and inspector width on this computer.

Studio ships the same bold Liberation fonts for preview and export. Backdrop media fills and crops to 16:9 in both. GIF preview uses the FFmpeg path in Preferences. CD+G keeps its standard resolution and limited color palette. [Liberation Fonts license](../public/lyric-fonts/LICENSE)

| Action | Shortcut |
| --- | --- |
| Open project | Ctrl+O / Cmd+O |
| Save project | Ctrl+S / Cmd+S |
| Save as a new project | Ctrl+Shift+S / Cmd+Shift+S |
| Preferences | Ctrl+, / Cmd+, / Alt+, |
| Play or pause | Space |
| Capture the next line or word during manual timing | Space |

Space keeps its usual behavior in text fields, and manual timing also has dedicated buttons in the playback bar.
