!include "WinMessages.nsh"

!macro customInstall
	SetOutPath "$PLUGINSDIR"
	File /oname=nsis-path.ps1 "${BUILD_RESOURCES_DIR}/nsis-path.ps1"
	nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\nsis-path.ps1" -Mode Add -Dir "$INSTDIR\resources\bin"'
	Pop $R9
	SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
	StrCmp $R9 0 +2
	Abort "Fast: failed to add CLI to user PATH"
!macroend

!macro customUnInstall
	SetOutPath "$PLUGINSDIR"
	File /oname=nsis-path.ps1 "${BUILD_RESOURCES_DIR}/nsis-path.ps1"
	nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\nsis-path.ps1" -Mode Remove -Dir "$INSTDIR\resources\bin"'
	Pop $R9
	SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
