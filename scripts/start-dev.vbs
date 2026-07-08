Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectPath = fso.GetAbsolutePathName("..").TrimEnd("\")
cmdPath = projectPath & "\scripts\start-dev.bat"
WshShell.Run """" & cmdPath & """", 0, False
WScript.Sleep 3000
WshShell.Run "http://127.0.0.1:5173", 1, False
