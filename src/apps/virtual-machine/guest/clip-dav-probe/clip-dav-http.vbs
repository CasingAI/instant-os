' clip-dav-http.vbs - single HTTP/WebDAV probe from XP
' (phase-1 probe of the "DAV clipboard paste" plan).
'
' usage: cscript //nologo clip-dav-http.vbs <METHOD> <URL> [DEPTH]
'
' Sends one request with the system HTTP client (MSXML; ServerXMLHTTP
' preferred because it accepts arbitrary verbs like PROPFIND and has
' timeouts), prints status line, capped response headers and a capped
' body preview. ASCII output only, so the log survives any codepage.
Option Explicit
Dim args, method, url, depth
Set args = WScript.Arguments
If args.Count < 2 Then
  WScript.Echo "usage: clip-dav-http.vbs <METHOD> <URL> [DEPTH]"
  WScript.Quit 2
End If
method = UCase(args(0))
url = args(1)
depth = ""
If args.Count >= 3 Then depth = args(2)

Dim progIds, progId, http
progIds = Array("MSXML2.ServerXMLHTTP.3.0", "MSXML2.ServerXMLHTTP", "MSXML2.XMLHTTP.3.0", "Microsoft.XMLHTTP")
Set http = Nothing
For Each progId In progIds
  On Error Resume Next
  Err.Clear
  Set http = CreateObject(progId)
  On Error Goto 0
  If Not http Is Nothing Then Exit For
Next
If http Is Nothing Then
  WScript.Echo "error: no usable XMLHTTP progid on this system"
  WScript.Quit 3
End If
WScript.Echo "progid=" & progId

On Error Resume Next
If InStr(progId, "ServerXMLHTTP") > 0 Then http.setTimeouts 5000, 5000, 8000, 8000
http.open method, url, False
If depth <> "" Then http.setRequestHeader "Depth", depth
http.setRequestHeader "User-Agent", "clip-dav-probe/1"
If Err.Number <> 0 Then
  WScript.Echo "open failed: " & Err.Number & " " & Err.Description
  WScript.Quit 1
End If
If method = "PROPFIND" Then
  http.send "<?xml version=""1.0"" encoding=""utf-8""?><d:propfind xmlns:d=""DAV:""><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>"
Else
  http.send
End If
If Err.Number <> 0 Then
  WScript.Echo "send failed: " & Err.Number & " " & Err.Description
  WScript.Quit 1
End If
On Error Goto 0

WScript.Echo "status=" & http.status & " " & http.statusText

Dim hdrs
hdrs = http.getAllResponseHeaders
If Len(hdrs) > 500 Then hdrs = Left(hdrs, 500) & "...(truncated)"
hdrs = Replace(hdrs, vbCrLf, " | ")
If Right(hdrs, 3) = " | " Then hdrs = Left(hdrs, Len(hdrs) - 3)
WScript.Echo "headers: " & hdrs

Dim bodyText
On Error Resume Next
Err.Clear
bodyText = http.responseText
If Err.Number <> 0 Then
  WScript.Echo "body: (unreadable as text)"
Else
  If Len(bodyText) > 200 Then bodyText = Left(bodyText, 200) & "...(truncated)"
  bodyText = Replace(bodyText, vbCrLf, " \n ")
  WScript.Echo "body: " & bodyText
End If
On Error Goto 0
