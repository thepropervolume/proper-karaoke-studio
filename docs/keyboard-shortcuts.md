# Keyboard shortcuts

Open **Preferences → Keyboard Shortcuts** or press **Ctrl+/**, **Cmd+/**, or **F1**. Click an assigned key to replace it, choose **+ Add** to assign an alternate, or use **×** to remove an assignment. Press **Save Shortcuts** to use your changes right away. Shortcut changes save separately from the Preferences split button. **Reset to Defaults** restores and saves the original bindings.

| Action | Defaults |
|---|---|
| Open / Save Project | Ctrl+O / Ctrl+S or Cmd+O / Cmd+S |
| Save Project As | Ctrl+Shift+S or Cmd+Shift+S |
| Open Preferences | Ctrl+, or Cmd+, or Alt+, |
| Show Keyboard Shortcuts | Ctrl+/ or Cmd+/ or F1 |
| Import Audio | Ctrl+I or Cmd+I |
| Import Lyrics | Ctrl+Shift+I or Cmd+Shift+I |
| Play / Pause | Space |
| Jump to Start | Home |
| Skip Back 5 Seconds / Forward 10 Seconds | Left / Right |
| Format Lyrics | Ctrl+Shift+L or Cmd+Shift+L |
| Time Lines / Time Words | Alt+L / Alt+W |
| Toggle Full Screen | F11 or Ctrl+Cmd+F |
| Export MP4 | Ctrl+Shift+E or Cmd+Shift+E |
| Mark Line or Word during timing | Space |
| Undo / Redo Timing Mark | Ctrl+Z or Cmd+Z / Ctrl+Y or Ctrl+Shift+Z or Cmd+Shift+Z |
| Cancel / Finish Timing | Escape / Enter |

While a field or control has focus, its usual typing, clipboard, and navigation keys take precedence. Timing and editing can assign the same chord to different actions, such as Space for marking a cue during timing and playing or pausing during editing. Conflicts within one mode show both action names. Escape cancels shortcut recording and Tab moves the focus to the Cancel Recording button.

## JSON configuration

The file buttons in **Keyboard Shortcuts** show the app's `settings.json` and `keybindings.json` in the file manager. **Edit Custom Shortcuts** opens the keybindings file in the default editor. Choose **Reload Shortcuts** after editing it, or restart Studio. Close Studio before editing `settings.json`.

Use physical key codes with `Control`, `Alt`, `Shift`, or `Meta`. For example, `{"open":["Control+KeyO","Meta+KeyO"],"export-mp4":[]}`. An empty array disables that action's shortcut. Omitted actions receive their defaults where those bindings are free. Studio keeps the last working bindings if the file is malformed and leaves the file available for repair.
