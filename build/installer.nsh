; Integração do comando `maestro` no Windows: cria um shim que lança o app com
; argumentos e adiciona o diretório de instalação ao PATH do usuário.
; Usa o plugin EnVar (domínio público) vendorizado em build/nsis-plugins/.
!addplugindir /x86-unicode "${BUILD_RESOURCES_DIR}\nsis-plugins"

!macro customInstall
  ; shim: `maestro [pasta]` → abre o app (e a pasta como projeto, se informada)
  FileOpen $9 "$INSTDIR\maestro.cmd" w
  FileWrite $9 '@echo off$\r$\n'
  FileWrite $9 'start "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" %*$\r$\n'
  FileClose $9
  ; adiciona ao PATH do usuário (EnVar::AddValue não duplica)
  EnVar::SetHKCU
  EnVar::AddValue "Path" "$INSTDIR"
  Pop $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\maestro.cmd"
  EnVar::SetHKCU
  EnVar::DeleteValue "Path" "$INSTDIR"
  Pop $0
!macroend
