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
on run argv
  set action to item 1 of argv
  set target to item 2 of argv
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
