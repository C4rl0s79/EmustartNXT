; Lumen keeps its data in LumenData\ next to Lumen.exe (settings, the EmuStart game cache,
; emulators, BIOS files, saves). electron-builder's uninstaller removes the whole install folder,
; also when updating — this replaces that step: program files go, LumenData stays.

!macro customRemoveFiles
  SetOutPath $TEMP
  FindFirst $R1 $R2 "$INSTDIR\*.*"
  lumen_rm_loop:
    StrCmp $R2 "" lumen_rm_done
    StrCmp $R2 "." lumen_rm_next
    StrCmp $R2 ".." lumen_rm_next
    StrCmp $R2 "LumenData" lumen_rm_next
    IfFileExists "$INSTDIR\$R2\*.*" 0 lumen_rm_file
      RMDir /r "$INSTDIR\$R2"
      Goto lumen_rm_next
    lumen_rm_file:
      Delete "$INSTDIR\$R2"
    lumen_rm_next:
      FindNext $R1 $R2
      Goto lumen_rm_loop
  lumen_rm_done:
  FindClose $R1
  ; removes the folder only when nothing is left (no LumenData)
  RMDir $INSTDIR
!macroend

; "Uruchamiaj z Windows" (Deck): the login item Lumen writes (value "Lumen" in the user's Run key) goes with
; an uninstall — not with an update (the old version's uninstaller runs then too; the setting stays)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lumen"
    ; Lumen jako administrator: autostart to zadanie Harmonogramu z najwyższymi uprawnieniami — po odinstalowaniu
    ; uruchamiałoby przy logowaniu, co trafi pod tę ścieżkę. Usunięcie wymaga administratora (jedno okno UAC),
    ; tylko gdy zadanie istnieje.
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Query /TN "Lumen autostart"'
    Pop $R0
    ${if} $R0 == 0
      ExecShellWait "runas" "$SYSDIR\schtasks.exe" '/Delete /TN "Lumen autostart" /F' SW_HIDE
    ${endIf}
  ${endIf}
!macroend
