# BLUEPRINT — Sistema de Gravação de Audiências Judiciais (TRF1)

## O que é este projeto

Uma aplicação web para gravação de audiências judiciais no Tribunal Regional Federal da 1ª Região (TRF1). Substitui o sistema anterior (Kenta DRS) que sofria com travamentos e perda de gravações. O diferencial técnico é a gravação em chunks contínuos com persistência local (IndexedDB) e recuperação automática após falhas, garantindo que nenhuma audiência seja perdida.

## Para quem

- **Servidores do Tribunal:** Operadores que iniciam, pausam e encerram gravações nas salas de audiência
- **Juízes:** Magistrados que consultam e reproduzem gravações posteriormente

**Escopo MVP:** 1 vara piloto (~2 servidores + 1 juiz)

## Problema central

O Kenta DRS apresenta travamentos frequentes e erros de exceção durante gravações de audiências em andamento, resultando em perda total do registro. Isso gera insatisfação dos usuários e risco de prejuízo processual.

## Hipótese do MVP

"Uma aplicação web com gravação em chunks (MediaRecorder + IndexedDB) e recuperação automática é capaz de gravar audiências de 15 minutos a 2 horas, nos modos presencial e híbrido, sem perda de dados."

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14+ (App Router) + React 18+ |
| Styling | Tailwind CSS |
| Estado Client | Zustand (global) + React state (local) |
| Gravação | MediaRecorder API + IndexedDB (via idb) |
| Captura de Tela | getDisplayMedia API (modo híbrido/Teams) |
| Câmera/Mic | getUserMedia API (Logitech Group + USB mic) |
| Backend | Next.js API Routes |
| Banco de Dados | PostgreSQL (metadados, usuários) |
| ORM | Prisma |
| Autenticação | NextAuth.js (credentials provider, JWT) |
| Armazenamento de Vídeo | Filesystem do servidor local do tribunal |
| Transcrição | whisper.cpp local + FFmpeg (sob demanda) |
| Player de Vídeo | HTML5 `<video>` nativo |
| Testes | Vitest + Playwright (E2E) |
| Linting | ESLint + Prettier |

## Funcionalidades do MVP (IN)

### Módulo de Gravação (Core)
- [x] Gravação de vídeo+áudio unificados (Logitech Group + mic USB) via MediaRecorder
- [x] Captura de tela do Microsoft Teams (modo híbrido) via getDisplayMedia
- [x] Seleção de modo: Presencial ou Híbrido
- [x] Gravação em chunks com salvamento no IndexedDB a cada 5 segundos
- [x] Detecção automática de dispositivos conectados (câmera e microfone)
- [x] Controles: iniciar, pausar, retomar e encerrar
- [x] Recuperação completa após falha (detecção + retomar ou finalizar)
- [x] Indicadores visuais: status REC pulsante, timer, chunks salvos, espaço em disco
- [x] Diálogo de confirmação ao encerrar gravação
- [x] Notificações toast (USB desconectado, disco baixo, erros)
- [x] 3 layouts de preview no modo híbrido (PiP, lado a lado, tabs)

### Metadados (Simplificado — sem integração PJe)
- [x] Formulário manual: número do processo, classe processual, partes, vara, juiz, tipo de audiência, data/hora
- [x] Máscara para número de processo (NNNNNNN-NN.NNNN.N.NN.NNNN)
- [x] Vinculação dos metadados à gravação

### Armazenamento e Consulta (Simplificado)
- [x] Upload do arquivo final consolidado para servidor local
- [x] Lista simples de gravações (sem filtros avançados)
- [x] Busca por número de processo
- [x] Reprodutor de vídeo integrado (HTML5 `<video>`)
- [x] Download de gravações

### Autenticação e Acesso
- [x] Login com usuário e senha
- [x] Dois perfis: Servidor (grava + consulta) e Juiz (consulta + download)
- [x] Rotas protegidas por perfil

## Funcionalidades FORA do MVP

- Integração com API do PJe (busca automática de metadados)
- Filtros avançados de consulta (data range, vara, juiz)
- Logs de auditoria
- Transcrição automática ao finalizar upload
- Geração de Ata/Termo de Audiência
- Editor rico de documentos
- Exportação PDF/DOCX
- Disponibilização às partes via PJe

## Arquitetura de Telas (6 telas)

```
Login ─→ Dashboard ─→ Nova Gravação (wizard 3 passos) ─→ Gravação em Andamento
                   ─→ Consulta de Gravações ─→ Reprodução + Download
```

### 1. Login (`/login`)
- Card centralizado, fundo azul institucional
- Campos: usuário + senha
- Acesso: público

### 2. Dashboard (`/dashboard`)
- **Servidor:** CTA "Nova Gravação" em destaque + lista de gravações recentes + banner de recuperação (se houver gravação interrompida)
- **Juiz:** Campo de busca por processo + lista de gravações recentes da vara
- Header com navegação contextual (sem sidebar)

### 3. Nova Gravação (`/gravacao/nova`) — Servidor apenas
- Wizard de 3 passos com progress indicator:
  - Passo 1: Formulário de metadados do processo (manual)
  - Passo 2: Confirmar metadados + selecionar modo (presencial/híbrido) + verificar dispositivos
  - Passo 3: Tela de gravação em andamento (imersiva)

### 4. Gravação em Andamento (`/gravacao/:id`) — Servidor apenas
- **Tela imersiva** (sem header global) — esta é a tela mais crítica
- Preview de vídeo dominante (~70-80% da tela)
- Barra superior: nº processo + modo + indicador REC pulsante + timer
- Painel lateral direito: metadados do processo (read-only)
- Barra inferior: indicadores de chunks/disco + controles grandes estilo estúdio (64px, circulares)
  - Pausar: amarelo (#F9A825)
  - Encerrar: cinza escuro com confirmação via modal
- Modo híbrido: seletor de layout (PiP / lado a lado / tabs)

### 5. Consulta de Gravações (`/consulta`)
- Lista simples de gravações
- Busca por número de processo
- Tabela: processo, data, duração, modo
- Clique abre reprodução
- Acesso: Servidor + Juiz

### 6. Reprodução (`/gravacao/:id/reproduzir`)
- Reprodutor de vídeo HTML5
- Metadados da gravação
- Botão de download
- Acesso: Servidor + Juiz

## Design System (Inspirado no PJe)

### Paleta de Cores
| Token | Hex | Uso |
|-------|-----|-----|
| primary | #1B3A5C | Header, títulos, destaque institucional |
| secondary | #2E75B6 | Links, botões secundários, bordas ativas |
| accent | #4A90D9 | Hover, seleção, foco |
| bg-page | #F5F7FA | Fundo geral |
| bg-card | #FFFFFF | Cards, modais |
| bg-dark | #1B3A5C | Header, barra de gravação |
| text-primary | #1A1A1A | Texto principal |
| text-secondary | #555555 | Labels, texto de apoio |
| text-muted | #888888 | Placeholders |
| success | #2E7D32 | Chunks salvos, sucesso |
| warning | #F9A825 | Alertas, pausa, disco baixo |
| error | #C62828 | Erros, REC ativo, encerrar |
| border | #C0C0C0 | Bordas gerais |
| table-stripe | #E8F0F8 | Linhas alternadas |

### Tipografia
- Headings e body: Inter (fallback: Arial)
- Timer/monospace: JetBrains Mono (fallback: Courier)
- Tamanhos: 24px (título), 18px (subtítulo), 14px (corpo), 12px (meta)

### Espaçamento
- Grid: 12 colunas, base 1920px, margin 24px, gutter 16px
- Unidade base: 4px
- Padding cards: 24px
- Border radius: 8px (cards), 4px (inputs), 50% (botões circulares)

### Elevação
- Nível 1: `0 1px 3px rgba(0,0,0,0.12)` — cards
- Nível 2: `0 4px 12px rgba(0,0,0,0.15)` — dropdowns, toasts
- Nível 3: `0 8px 24px rgba(0,0,0,0.2)` — modais

## Restrições Técnicas

- **Resolução alvo:** 1920×1080 (Full HD, 16:9)
- **Resolução mínima:** 1366×768
- **Plataforma:** Desktop/Notebook apenas (sem mobile/tablet)
- **Navegadores:** Chrome e Edge (versões recentes)
- **Hardware:** Logitech Group (câmera) + microfone USB externo
- **Armazenamento:** Servidor local do tribunal (filesystem)
- **Tolerância de perda:** ≤ 5 segundos por incidente
- **Duração suportada:** 15 minutos a 2 horas contínuas

## Configuração de transcrição local (`whisper.cpp`)

- A transcrição é manual por item na tela `/consulta` (não roda automaticamente no upload).
- Dependências obrigatórias no servidor:
  - `ffmpeg` instalado e disponível no `PATH`;
  - binário do `whisper.cpp` (ex.: `main`/`whisper-cli`);
  - arquivo de modelo local (`ggml-*.bin`).
- Variáveis de ambiente necessárias:
  - `WHISPER_CPP_BIN` — caminho absoluto do executável do `whisper.cpp`;
  - `WHISPER_MODEL_PATH` — caminho absoluto do modelo local.
- Fluxo técnico:
  - o backend normaliza o áudio para WAV mono 16kHz com FFmpeg;
  - executa `whisper.cpp`;
  - persiste status (`PENDENTE`, `PROCESSANDO`, `CONCLUIDA`, `ERRO`) e resultado da transcrição.

## Conformidade Regulatória (Aplicável ao MVP)

- **Resolução Conjunta CNJ/CNMP (2025):** Gravação integral em sistema oficial + armazenamento seguro
- **LGPD:** Voz e imagem são dados pessoais sensíveis — uso limitado à finalidade processual
- Controle de acesso por perfil (Servidor/Juiz)

## Métricas de Sucesso do MVP

| Métrica | Alvo |
|---------|------|
| Gravações sem perda | ≥ 95% |
| Perda máxima por falha | ≤ 5 segundos |
| Recuperações bem-sucedidas | 100% (testes controlados) |
| Gravações de 2h estáveis | ≥ 3 testes |
| Modo híbrido estável | ≥ 3 testes |
| Satisfação usuários piloto | ≥ 7/10 |

## Documentos de Referência

- `docs/PRD_Gravacao_Audiencias_TRF1.docx` — Documento de Requisitos de Produto completo
- `docs/UX_UI_Specs_Gravacao_Audiencias_TRF1.docx` — Especificações de UX & UI
- `docs/MVP_Conceito_Gravacao_Audiencias_TRF1.docx` — Conceito do MVP
