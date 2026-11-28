!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ; electron-builder has already added the directory page at this point.
    ; Let its upgrade logic preserve shortcuts when the registered installation
    ; exists in the selected directory, including when setup was opened manually.
    !ifdef allowToChangeInstallationDirectory
      !undef allowToChangeInstallationDirectory
    !endif
  !endif
!macroend

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

; Update the existing Start shortcut in place so upgrades preserve its identity.
!macro UpdateStartMenuSearchTerms
  ${If} ${FileExists} "$newStartMenuLink"
    System::Store S
    StrCpy $3 "$newStartMenuLink"
    StrCpy $4 "TPV; Proper; Proper Volume; The Proper Volume; Karaoke; Karaoke App; Studio; Builder Studio; Karaoke Studio; Lyrics; Synchronize; LRC; CDG; SRT"
    ; IShellLinkW and IPersistFile work on the original .lnk, including its AUMID.
    System::Call "ole32::CoCreateInstance(g'{00021401-0000-0000-C000-000000000046}',p0,i1,g'{000214F9-0000-0000-C000-000000000046}',*p.r1)i.r0"
    ${If} $0 = 0
      System::Call "$1->0(g'{0000010B-0000-0000-C000-000000000046}',*p.r2)i.r0"
      ${If} $0 = 0
        System::Call "$2->5(w r3,i2)i.r0"
        ${If} $0 = 0
          System::Call "$1->7(w r4)i.r0"
          ${If} $0 = 0
            System::Call "$2->6(w r3,i1)i.r0"
          ${EndIf}
        ${EndIf}
        System::Call "$2->2()"
      ${EndIf}
      System::Call "$1->2()"
    ${EndIf}
    ${If} $0 = 0
      System::Call "shell32::SHChangeNotify(i0x2000,i5,w r3,p0)"
    ${Else}
      DetailPrint "Could not update Studio Start menu search metadata ($0)."
    ${EndIf}
    System::Store L
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro UpdateStartMenuSearchTerms
  !insertmacro UpdateStudioCliPath "add"
  ; Differentiate an installed copy from the portable ZIP without guessing
  ; the user's installation directory or registry scope.
  ClearErrors
  FileOpen $0 "$INSTDIR\resources\tpv-studio-install-kind" w
  IfErrors +3
    FileWrite $0 "nsis"
    FileClose $0
!macroend

!macro customUnInstall
  !insertmacro UpdateStudioCliPath "remove"
  Delete "$INSTDIR\resources\tpv-studio-install-kind"
!macroend
