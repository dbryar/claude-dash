-- Controls the Terminal tab attached to a tty.
--
-- osascript terminal.applescript type /dev/ttysNNN "<text>"
--   Types the text and submits it. Prints "ok", or "notab".
--   The caller supplies the text already cleaned. The text is typed first and the carriage
--   return that submits it is sent separately: Claude Code reads a carriage return that
--   arrives in the same burst as the text as part of a paste, which adds a line instead of
--   submitting. The line feed do script appends after each write lands in the input box
--   harmlessly (trailing whitespace is dropped from the text, and the box is empty after
--   submission).
--
-- osascript terminal.applescript close /dev/ttysNNN
--   Closes the tab's window if the tab holds only login and a shell and is the window's
--   only tab; types "exit" into the shell if it holds only those but shares the window.
--   Prints "closed", "exited", "busy:<processes>" or "notab".
--
-- osascript terminal.applescript screen /dev/ttysNNN
--   Prints the last 6,000 characters of the tab's text, or "notab".
--
-- osascript terminal.applescript keys /dev/ttysNNN "<keys>"
--   Writes the keys once. do script always follows them with a line feed, which Claude Code's
--   menus read as Enter, so each write is one step that ends in Enter. Prints "ok" or "notab".
--
-- osascript terminal.applescript new "<directory>"
--   Starts claude in the directory, in a new tab of the frontmost Terminal window. When macOS is
--   set to open windows as tabs (AppleWindowTabbingMode "always"), a new window from do script
--   is a tab already: prints "tab:merged". The new tab opens behind: the tab that was selected is
--   selected again, and if Terminal comes to the front the application that was there is brought back. Otherwise Terminal's dictionary cannot make a tab, so
--   Cmd-T is pressed through System Events (needs Accessibility permission) and the new tab is
--   found by its new tty: prints "tab". Cmd-T needs Terminal in front, so afterwards the previous
--   tab is selected again and the application that was in front is brought back. If no new tab appears, nothing is typed into an existing
--   tab and a new window is opened: prints "window" (Terminal had no window) or
--   "window:notab:<System Events error, if any>". The caller has checked the directory exists.
on run argv
  set action to item 1 of argv
  set target to item 2 of argv
  if action is "new" then return startSession(target)
  set shells to {"login", "-zsh", "zsh", "-bash", "bash", "-sh", "sh", "-fish", "fish"}
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          if action is "type" then
            do script (item 3 of argv) in t
            delay 0.4
            do script (ASCII character 13) in t
            return "ok"
          else if action is "screen" then
            set h to history of t
            set n to count of h
            if n > 6000 then set h to text (n - 5999) thru n of h
            return h
          else if action is "keys" then
            do script (item 3 of argv) in t
            return "ok"
          else if action is "close" then
            set procs to processes of t
            repeat with p in procs
              if shells does not contain (p as text) then
                set AppleScript's text item delimiters to ", "
                return "busy:" & (procs as text)
              end if
            end repeat
            if (count of tabs of w) is 1 then
              close w
              return "closed"
            end if
            do script "exit" in t
            return "exited"
          end if
        end if
      end repeat
    end repeat
  end tell
  return "notab"
end run

on startSession(dir)
  set cmd to "cd " & quoted form of dir & " && claude"
  -- With macOS set to prefer tabs always, a new Terminal window opens as a tab of the front one.
  set tabbing to ""
  try
    set tabbing to do shell script "defaults read -g AppleWindowTabbingMode"
  end try
  -- The application in front now, brought back afterwards if Terminal takes its place.
  set prevApp to frontBundle()
  tell application "Terminal"
    -- The new tab is opened behind: whichever tab you were in stays selected, so typing carries on
    -- there. Terminal lists each tab as a window, front to back, so the front one is the selected tab.
    set prevId to missing value
    if (count of (windows whose visible is true)) > 0 then set prevId to id of (first window whose visible is true)
    if tabbing is "always" then
      do script cmd
      if prevId is not missing value then set index of window id prevId to 1
    end if
  end tell
  if tabbing is "always" then
    restoreFront(prevApp)
    return "tab:merged"
  end if
  tell application "Terminal"
    -- Terminal lists every native tab as its own window, so a tab is recognised by a new tty.
    set ttysBefore to {}
    repeat with w in windows
      repeat with t in tabs of w
        set end of ttysBefore to (tty of t)
      end repeat
    end repeat
    if (count of (windows whose visible is true)) is 0 then
      do script cmd
      return "window"
    end if
  end tell
  tell application "Terminal" to activate
  -- activate returns before Terminal is frontmost; a key press sent sooner goes to another app.
  repeat 30 times
    if frontmost of application "Terminal" then exit repeat
    delay 0.1
  end repeat
  set why to ""
  try
    tell application "System Events" to keystroke "t" using command down
  on error e
    set why to e
  end try
  tell application "Terminal"
    repeat 20 times
      repeat with w in windows
        repeat with t in tabs of w
          if ttysBefore does not contain {(tty of t) as text} then
            do script cmd in t
            set index of window id prevId to 1
            my restoreFront(prevApp)
            return "tab"
          end if
        end repeat
      end repeat
      delay 0.1
    end repeat
    do script cmd
  end tell
  restoreFront(prevApp)
  return "window:notab:" & why
end startSession

-- The bundle id of the frontmost application, read without Apple Events, so no permission is asked.
on frontBundle()
  try
    return do shell script "lsappinfo info -only bundleid \"$(lsappinfo front)\" | sed -n 's/.*=\"\\(.*\\)\"$/\\1/p'"
  end try
  return ""
end frontBundle

-- Terminal comes to the front a moment after a new tab or window opens. If it was not in front
-- before, wait up to 1.5 seconds for that, then bring the previous application back with open -b,
-- which needs no permission either.
on restoreFront(prevApp)
  if prevApp is "" or prevApp is "com.apple.Terminal" then return
  repeat 15 times
    if frontBundle() is "com.apple.Terminal" then
      do shell script "open -b " & quoted form of prevApp
      return
    end if
    delay 0.1
  end repeat
end restoreFront
