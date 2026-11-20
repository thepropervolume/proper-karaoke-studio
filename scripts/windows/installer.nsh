!macro UpdateStudioCliPath operation
  InitPluginsDir
  File /oname=$PLUGINSDIR\studio-path.exe "${PROJECT_DIR}\dist-electron\windows-cli\studio-path.exe"
  nsExec::ExecToStack '"$PLUGINSDIR\studio-path.exe" "${operation}" "$installMode" "$INSTDIR\cli" "${INSTALL_REGISTRY_KEY}"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    DetailPrint "Studio CLI PATH update failed ($0): $1"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Studio could not update the Windows PATH. $1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro UpdateStudioCliPath "add"
!macroend

!macro customUnInstall
  !insertmacro UpdateStudioCliPath "remove"
!macroend
