# Transcricao contextual em tempo real

## 1) Auditoria do fluxo atual

### Pontos auditados
- Captura de fala no navegador: `src/hooks/useSpeechRecognition.ts`
- Orquestracao da gravacao e envio incremental: `src/components/recording/RecordingScreen.tsx`
- Persistencia incremental de transcricao: `src/app/api/gravacoes/[id]/transcricao/route.ts`

### Resultado da auditoria
- O fluxo atual suporta transcricao assistiva em tempo real.
- A Web Speech API nao oferece controle confiavel de vocabulario juridico.
- A persistencia incremental estava baseada apenas em texto concatenado, com baixa rastreabilidade para medicao de qualidade contextual.

### Pontos de falha de contexto identificados
- nomes proprios de partes e magistrado;
- numero do processo com pontuacao mascarada;
- termos juridicos com grafia semelhante;
- ausencia de diarizacao por falante.

## 2) Estrategia de pos-processamento contextual (MVP)

### Objetivo
Melhorar acuracia sem substituir o fluxo atual de Web Speech.

### Implementacao
- Novo modulo: `src/lib/transcription-context.ts`
- Correcoes aplicadas por segmento:
  - normalizacao de espacos;
  - formatacao contextual de numero de processo (CNJ) quando padrao de 20 digitos for identificado;
  - reforco de entidades da audiencia (juiz, vara, classe) por substituicao orientada a metadados.
- Metadados utilizados:
  - `numeroProcesso`, `classeProcessual`, `partes`, `vara`, `nomeJuiz`, `tipoAudiencia`, `dataAudiencia`.

### Integracao
- A rota `PATCH /api/gravacoes/:id/transcricao` passa a:
  - aplicar correcoes contextuais antes de concatenar texto;
  - retornar diagnostico objetivo (`correcoes` e `acerto de entidades`).

## 3) Protocolo de validacao e metricas

### Cenarios de teste
1. Baseline: Web Speech sem correcao contextual.
2. Contextual: Web Speech com pos-processamento contextual no backend.

### Indicadores de qualidade
- **entityHit_processNumber**: se o numero do processo aparece correto no texto final;
- **entityHit_judgeName**: se o nome do juiz aparece corretamente;
- **entityHit_partiesCount**: quantidade de partes reconhecidas no texto;
- **correctionsApplied**: numero de correcoes contextuais aplicadas pelo backend;
- **stability**: continuidade de captura durante gravacao longa (sem interrupcao definitiva).

### Criterio de aceitacao do MVP
- ganho objetivo de acerto de entidades juridicas sem regressao no fluxo de gravacao/upload.

## 4) Decisao de arquitetura

### Decisao atual
Manter arquitetura **MVP assistiva**:
- Web Speech API como captura ao vivo;
- backend contextual para aumentar acuracia;
- transcricao marcada como preliminar para revisao humana.

### Evolucao recomendada
Migrar para ASR server-side quando houver necessidade de:
- vocabulario juridico customizado por audiencia;
- maior previsibilidade entre navegadores;
- trilha de qualidade para uso oficial sem revisao intensa.
