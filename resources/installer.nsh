; Explorer: right-click a folder, or the empty space inside one, for "Open in Tezgah".
; Per user (HKCU), like the installer; removed on uninstall.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\Tezgah" "" "Open in Tezgah"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Tezgah" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Tezgah\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Tezgah" "" "Open in Tezgah"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Tezgah" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Tezgah\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Tezgah"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Tezgah"
!macroend
