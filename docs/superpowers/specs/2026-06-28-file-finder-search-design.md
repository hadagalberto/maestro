# File Finder + Search — Design (sub-projeto #7)

**Data:** 2026-06-28
**Projeto:** Maestro — app desktop para orquestrar CLIs de IA
**Base:** #1–#6 no `main`.
**Escopo:** localizar e ler arquivos do projeto sem sair do app — **fuzzy file finder** (estilo VSCode Ctrl+P), **find-in-files** (regex / case / whole-word), e um **viewer read-only com syntax highlight (Shiki)**. Respeita `.gitignore`.

---

## 1. Objetivo

Recriar o finder/busca do HiveTerm: achar arquivos por nome (fuzzy ponderado), buscar texto em todos os arquivos (com regex/case/word), e ver o conteúdo com destaque de sintaxe (37+ langs via Shiki). Tudo respeitando `.gitignore`.

### Critérios de sucesso

1. **File finder** (Ctrl+P / botão): digita → lista fuzzy de arquivos do projeto (filename ponderado sobre path), com os caracteres casados destacados; Enter/clique abre o viewer.
2. **Find-in-files** (Ctrl+Shift+F / botão): query + toggles regex/case/word → resultados (arquivo → linhas com a linha de match); clique abre o viewer naquele arquivo.
3. **Viewer**: conteúdo read-only com **syntax highlight** por extensão (Shiki, tema dark); arquivo grande/binário tratado (cap + aviso).
4. Listagem e busca **respeitam `.gitignore`** (git ls-files/grep); fallback p/ projeto não-git.
5. Sem projeto aberto → "abra um projeto". File/grep rodam no **main** no root do projeto.

### Fora de escopo (futuro / #8)

Editar arquivos, abrir em editor externo, search-and-replace, ir até a linha exata no viewer (v1 abre o arquivo; scroll-to-line é nice-to-have), indexação/watch incremental, multi-root, preview de imagem. Shiki também pode depois colorir o diff do #6 (não agora).

---

## 2. Stack adicional

| Item | Escolha | Nota |
|---|---|---|
| Highlight | `shiki` ^4.3.0 (+ `@shikijs/langs`/`@shikijs/themes`/`@shikijs/core`/`@shikijs/engine-javascript` ^4.3.0) | **ESM-only → SÓ no renderer** (nunca no main; igual strip-ansi). `createHighlighterCore` + **JS engine** (sem WASM); lazy `loadLanguage` por-arquivo |
| Listagem/busca | git (`ls-files`/`grep`) via `captureOnce` (#3) | respeita `.gitignore`; binário resolvido por `which` |

(Listagem/busca não adicionam deps — reusam captureOnce + git. Fallback não-git é walk manual sem dep.)

---

## 3. Modelo de dados

```ts
// shared/files.ts
interface SearchMatch { line: number; text: string }
interface SearchFileResult { path: string; matches: SearchMatch[] }
interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean }
interface FileContent { path: string; content: string; truncated: boolean; binary: boolean }
// renderer fuzzy
interface FuzzyResult { path: string; score: number; positions: number[] }  // positions = índices casados (p/ highlight)
```

---

## 4. Unidades e interfaces

### 4.1 `FileService` — `src/main/files/fileService.ts` (main)
**Depende de:** `captureOnce` (#3), `which`, `node:fs`. Reaproveita o resolver de git (pode reusar de GitService ou ter o seu).
```ts
class FileService {
  constructor(cap?, whichSync?)
  async listFiles(root): Promise<string[]>      // git ls-files --cached --others --exclude-standard -z ; fallback walk
  async search(root, query, opts): Promise<SearchFileResult[]>   // git grep ; fallback walk+regex ; cap
  async read(root, relPath): Promise<FileContent>   // fs.readFile capado (~512KB); detecta binário (NUL nos 1os 8KB)
}
```
- **listFiles**: se git repo → `git ls-files --cached --others --exclude-standard -z` (tracked + untracked-não-ignorado, respeita `.gitignore`). Não-git → walk recursivo pulando `node_modules/.git/dist/out/release/.planning` (cap ~20k arquivos). Retorna paths relativos com `/`.
- **search**: git repo → `git grep -n -I --untracked [-i] [-w] [-E] -e <query> -z` (`-I` pula binário; `--untracked` inclui não-ignorados; `-i` case-insensitive; `-w` whole-word; `-E` extended regex quando `opts.regex`, senão fixed-string `-F`). Parse do `-z` (path\0... ou path:line:text por NUL). Cap total (~500 matches / ~50 arquivos) → flag truncado. Não-git → walk + RegExp por arquivo (bounded). Query literal escapada quando `!regex`.
- **read**: lê o arquivo (cap 512KB → `truncated`); binário (NUL nos primeiros 8KB) → `binary:true`, content vazio.
- Não-repo/sem-git: listFiles/search usam fallback walk; `which` falha → erro claro (mas walk não precisa de git).

### 4.2 parsers — `src/main/files/parseGrep.ts` (puro, testável)
`parseGrepZ(out: string): SearchFileResult[]` — parseia a saída `-z` do `git grep -n` (campos NUL: `path\0line\0text` por match, agrupando por path; ou o formato real do `-z` do grep → documentar e parsear). Agrupa matches por arquivo, aplica cap.

### 4.3 fuzzy — `src/renderer/files/fuzzy.ts` (puro, testável)
`fuzzyScore(query: string, target: string): { score: number; positions: number[] } | null` — subsequência case-insensitive; bônus: match consecutivo, início de palavra/segmento (`/`, `_`, `-`, camelCase), match no **basename** (peso maior que no path). `null` se não casa. `fuzzyFilter(query, paths): FuzzyResult[]` ordena desc por score, cap ~200.

### 4.4 Shiki highlighter — `src/renderer/files/highlighter.ts` (renderer)
Singleton (promise module-level). `createHighlighterCore({ engine: createJavaScriptRegexEngine(), themes: [import('@shikijs/themes/github-dark')], langs: [] })`. `highlight(code, ext): Promise<string>` → resolve lang id via `extToLang(ext)`; se não carregado, `await highlighter.loadLanguage(() => import('@shikijs/langs/<id>'))` (guard de Set de ids carregados; id inválido → 'text'); `highlighter.codeToHtml(code, { lang, theme:'github-dark' })`. `extToLang` = mapa ext→id (ts/tsx/js/jsx/json/md/css/html/py/rs/go/java/sh/yaml/toml/sql/etc., ~37) validado contra langs disponíveis; desconhecido → 'text'.

### 4.5 IPC + schemas
Canais (root = `currentProject`): `files:list`, `files:search {query,opts}`, `files:read {path}`. zod valida. Sem projeto → `[]` / conteúdo vazio.

### 4.6 Renderer UI
- `filesStore` (zustand): `files: string[]` (cache da lista), `loadFiles()`, `search(query,opts)`, `openFile(path)`, `viewer: FileContent|null`, `searchResults`, `busy`.
- **FileFinder** (overlay, Ctrl+P + botão "Buscar arquivo"): input no topo, lista fuzzy (filtra `files` com `fuzzyFilter`), highlight dos chars casados, ↑↓ navega, Enter abre. Carrega `files` (lazy, 1ª abertura ou refresh).
- **SearchPanel** (overlay/rail, Ctrl+Shift+F + botão "Buscar"): input + toggles (.* regex / Aa case / W word) → `files:search` → árvore arquivo→linhas (mostra a linha do match, número); clique abre o viewer.
- **FileViewer** (overlay): caminho + conteúdo Shiki-highlighted (render via `dangerouslySetInnerHTML` do output do Shiki; enquanto carrega, `<pre>` plano; binário → "(binário)"; truncado → aviso). read-only.
- Keybindings: listener global no App (Ctrl/Cmd+P → finder; Ctrl/Cmd+Shift+F → search). Botões na toolbar também.

## 5. Fluxo

Ctrl+P → FileFinder abre → `loadFiles()` (cache) → digita → `fuzzyFilter` local (rápido, sem IPC por tecla) → Enter → `openFile(path)` → `files:read` → FileViewer (Shiki). Ctrl+Shift+F → SearchPanel → query+toggles → `files:search` (IPC, debounce) → resultados → clique → `openFile`. 

## 6. Tratamento de erros

- Sem projeto → finder/search vazios com aviso "abra um projeto".
- git ausente → fallback walk (listagem/busca ainda funcionam, sem respeitar `.gitignore` perfeitamente — pulam node_modules/.git/dist/out).
- Regex inválida (`files:search` com regex on) → git grep retorna erro → resultado vazio + mensagem "regex inválida".
- Arquivo grande → `truncated` (mostra início + aviso). Binário → `binary` (não tenta highlight).
- Shiki: lang desconhecida → 'text' (sem throw); init falha → cai pro `<pre>` plano (highlight é enhancement, não bloqueia o viewer).
- Busca floda → cap (matches/arquivos) + flag truncado mostrado.

## 7. Testes

- **Unit (node) — fuzzy**: casa subsequência, bônus de boundary/basename, ranking, posições corretas, no-match → null.
- **Unit — parseGrepZ**: agrupa por arquivo, multi-match, cap.
- **Unit — FileService** (captureOnce+which mockados): listFiles monta `ls-files` certo; search monta flags certas (regex/case/word); read cap/binário.
- **Integration (node, repo git real temp)**: cria repo + arquivos + `.gitignore` (ignora `ignored.txt`); `listFiles` inclui os tracked/untracked-não-ignorados e **exclui** o ignorado; `search('hello')` acha no arquivo certo e não no ignorado; `read` devolve conteúdo.
- **Component (Browser Mode)**: FileFinder filtra e destaca; FileViewer renderiza conteúdo (highlight assíncrono — assere que o texto aparece, mockando o highlighter pra evitar carga do Shiki no teste).
- **E2E (Playwright)**: abre projeto git temp, Ctrl+P (ou botão), digita parte de um nome, vê o arquivo na lista; abre → viewer mostra o conteúdo.

## 8. Arquivos (novos/alterados)

```
+ src/shared/files.ts            SearchMatch/SearchFileResult/SearchOptions/FileContent
+ src/main/files/parseGrep.ts    parseGrepZ (+test)
+ src/main/files/fileService.ts  FileService (+test +integration repo real)
~ src/shared/ipc.ts              files:* channels
~ src/shared/schemas.ts          files:search/read arg schemas
~ src/main/ipcRouter.ts          files:* handlers (root = currentProject)
~ src/main/index.ts              constrói FileService + deps
~ package.json                   shiki + @shikijs/*
+ src/renderer/files/fuzzy.ts    fuzzyScore/fuzzyFilter (+test)
+ src/renderer/files/highlighter.ts  Shiki singleton + extToLang
+ src/renderer/store/filesStore.ts
+ src/renderer/ui/FileFinder.tsx
+ src/renderer/ui/SearchPanel.tsx
+ src/renderer/ui/FileViewer.tsx
~ src/renderer/App.tsx           botões + keybindings (Ctrl+P / Ctrl+Shift+F) + painéis
+ e2e/files.spec.ts
```

## Apêndice — decisões/armadilhas

- **Shiki é ESM-only → renderer apenas** (nunca src/main/preload; senão ERR_REQUIRE_ESM no main CJS, igual strip-ansi). Renderer é bundlado por Vite → ok sem mexer no externalize.
- **JS engine** (`shiki/engine/javascript`, sem WASM) em vez de Oniguruma — menor bundle, todas as langs bundladas suportadas (v3.9.1+). NÃO importar de 'shiki' shorthand nem 'shiki/engine/oniguruma' (puxa WASM ~MB).
- **Highlighter singleton** (promise module-level); init async, `codeToHtml` sync; **lazy `loadLanguage` por-arquivo** com guard de Set; ext→id próprio (Shiki não mapeia extensão); desconhecido → 'text'. `dangerouslySetInnerHTML` é seguro (Shiki escapa o código).
- **Listagem/busca via git** respeita `.gitignore`: `ls-files --cached --others --exclude-standard` e `git grep --untracked`; fallback walk (não-git) pula node_modules/.git/dist/out. git resolvido por `which` (absoluto; shell:false).
- **Fuzzy no cliente** (sem IPC por tecla) sobre a lista cacheada; **search via IPC** (git grep) com debounce.
- **Caps**: lista ~20k, fuzzy ~200, search ~500 matches/~50 arquivos, read 512KB, binário detectado por NUL → não destaca.
- `-z` (null) na listagem e no grep p/ paths com espaço/acento.
