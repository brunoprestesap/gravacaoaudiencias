# 0001. Redução automática do vídeo para o limite de 300 MB do PJe

**Date**: 2026-11-02
**Status**: In Progress

## Summary

Hoje, uma gravação com mais de cerca de 70 minutos sai maior que 300 MB, e o PJe recusa o arquivo. Com esta decisão, a conversão reduz a resolução e a taxa de dados (bits por segundo do vídeo) só quando o arquivo não caberia, e entrega um único MP4 sem nenhum passo a mais para o servidor. Gravações curtas não mudam. Acima de cerca de 3h10, a gravação é salva com a qualidade mínima e o aviso de que passou do limite.

## Requirements

**User stories**:
- Como servidor, quero que uma audiência de 2 horas saia em um arquivo aceito pelo PJe, sem passos extras, para anexá-la ao processo.
- Como servidor, quero saber quando a imagem foi reduzida, ou quando o arquivo passou do limite, para não ser surpreendido ao anexar.

**Acceptance criteria**:
- **AC-1**: Uma gravação em que o vídeo teria 500 kbps ou mais dentro do orçamento (até cerca de 68 minutos) tem a primeira tentativa igual à de hoje: mesma resolução, mesmo áudio e mesmo cálculo de taxa.
- **AC-2**: Uma gravação de 2 horas sai em 480p, com cerca de 275 kbps de vídeo e 64 kbps de áudio, e o arquivo real tem no máximo 300 MB.
- **AC-3**: Uma gravação de cerca de 2h10 a 3h10 sai em 360p, com pelo menos 150 kbps de vídeo, e o arquivo real tem no máximo 300 MB.
- **AC-4**: Acima de cerca de 3h10, a conversão usa o piso (360p, 150 kbps de vídeo, 64 kbps de áudio), salva a gravação, marca `apto: false` e devolve o aviso atual de que passou de 300 MB. A gravação nunca é recusada por tamanho.
- **AC-5**: A conversão nunca aumenta a resolução. Uma fonte menor que a altura da faixa mantém a própria altura.
- **AC-6**: Quando o arquivo coube graças à redução, a tela mostra um aviso dizendo que a imagem foi reduzida para caber no limite do PJe, nos dois fluxos: fim da gravação e finalização pelo banner de recuperação.
- **AC-7**: Quando o arquivo passou do limite, o aviso de limite também aparece nos dois fluxos. Hoje o banner de recuperação o descarta e mostra sucesso.
- **AC-8**: A nova tentativa (`mode=retryConversion`) segue as mesmas regras e devolve os mesmos avisos.
- **AC-9**: A transcrição não muda: o WAV continua saindo do WebM original, independente da redução.
- **AC-10**: Antes de o item ser concluído, o dono do produto aprova uma amostra convertida com as regras de 2 horas, nos modos presencial e híbrido, com rosto e gestos identificáveis. Se reprovar, as faixas são ajustadas antes de concluir.
- **AC-11**: A faixa é decidida na primeira tentativa. A segunda só roda se a primeira passar do limite e não estiver no piso, mantém a altura da faixa reduzida e recalcula a taxa pelo tamanho real medido.
- **AC-12**: Dois vídeos de 2 horas, um quase parado e um com bastante movimento, ficam em até 300 MB, e o tempo de conversão medido é aceito no ambiente real.

## Decision

**Chosen option**: Option 1: Reduzir só quando precisar

A conversão reduz resolução e taxa apenas quando o vídeo ficaria abaixo de 500 kbps dentro do orçamento de 300 MB, e guarda só o MP4 resultante.

## Feature design

**Data model sketch**: nenhuma mudança no banco.

**Primeira tentativa** (conversão em dois passos, preset `faster`, como hoje), decidida em `src/lib/upload-encoding.ts`. `total` é o orçamento em kbps, com a margem de 97%: `floor(PJE_TARGET_OUTPUT_SIZE_BYTES * 8 / (duração * 1000))`.

| Condição | Faixa | Altura máxima | Vídeo | Áudio |
|---|---|---|---|---|
| `total - 96 >= 500` | normal | a da fonte | `computeVideoKbps`, como hoje | 96 kbps, como hoje |
| senão, `total - 64 >= 250` | reduzida | 480 | `min(total - 64, 95% da taxa da fonte)`, com piso de 150 | 64 kbps, mono |
| senão | reduzida | 360 | `min(total - 64, 95% da taxa da fonte)`, com piso de 150 | 64 kbps, mono |

- As faixas reduzidas têm cálculo próprio. Não usam `computeVideoKbps` nem `estimateTargetVideoKbps`, que forçam o mínimo de 500 kbps, nem `maxVideoKbpsByDuration`.
- O piso de 150 kbps vence o limite da taxa da fonte.
- A faixa é escolhida pelo orçamento, não pela taxa da fonte.
- Pontos de corte: reduz a partir de cerca de 68 minutos, passa a 360p em cerca de 2h10 e chega ao piso em cerca de 3h10.

**Segunda tentativa** (um passo só, preset `fast`, como hoje). Roda só se o arquivo da primeira passar de `PJE_MAX_OUTPUT_SIZE_BYTES`, e não roda se a primeira já estava no piso de 150 kbps. Ela não pode ser montada de antemão, porque depende de `bytes1`, o tamanho medido.

`vídeo2 = (vídeo1 + áudio1) * PJE_TARGET_OUTPUT_SIZE_BYTES / bytes1 - áudio2`, com piso de 150 kbps.

| Faixa da primeira | Resultado | Altura máxima | Áudio |
|---|---|---|---|
| normal, com `vídeo2 >= 500` usando `áudio2 = 80` | normal | a da fonte | 80 kbps, como hoje |
| normal, com `vídeo2 < 500` | reduzida; recalcula `vídeo2` com `áudio2 = 64` | 480 | 64 kbps, mono |
| reduzida | reduzida | a mesma da primeira | 64 kbps, mono |

**Filtro de escala**: só nas faixas reduzidas, igual nos dois passos: `scale=-2:trunc(min(<altura>,ih)/2)*2`, com a vírgula escapada como o FFmpeg exige. Assim a altura é par e nunca maior que a da fonte, sem sondagem nova. O áudio mono usa `-ac 1`.

**API surface**: `POST /api/upload` mantém a forma da resposta.

| Campo | Mudança |
|---|---|
| `warning` | Aviso de limite, se o arquivo passou de 300 MB. Senão, aviso de imagem reduzida, se `qualityReduced` for verdadeiro. Senão, `null`. |
| `encoding` | Ganha `qualityReduced: boolean` e `maxHeight: number \| null`, para diagnóstico. |
| `pje.apto` | Sem mudança. |

Os campos novos entram em `EncodingPlan`, `EncodingDiagnostics` e `UploadResult.encoding`. Sem migração: o resultado só existe na resposta e nos logs.

**Interface do cliente**: `useRecovery.finalizar` passa de `Promise<boolean>` para `Promise<{ ok: true; warning: string | null } | { ok: false }>`. O `RecoveryBanner` mostra `toast.warning(warning)` no lugar do sucesso quando houver aviso, como o `RecordingScreen` já faz. O `toast.info` de estimado e final fica como está.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Plano de conversão | Duração | `duracao` do envio, senão a sondagem do arquivo, senão 30 minutos (como hoje) |
| Plano de conversão | Orçamento `total` | Derivado de `PJE_TARGET_OUTPUT_SIZE_BYTES`, da duração e do multiplicador |
| Plano de conversão | Taxa da fonte | `probeMediaInfo` (`format.bit_rate`, que inclui o áudio) |
| Segunda tentativa | `bytes1` | `stat` do arquivo gerado pela primeira tentativa |
| Filtro de escala | Altura da fonte | `ih`, resolvida pelo próprio FFmpeg |
| Conversão | `qualityReduced` | Verdadeiro quando a última tentativa rodada usou faixa reduzida, mesmo que a fonte já fosse menor. Falso na faixa normal e no remux |
| Conversão | `maxHeight` | Altura máxima da faixa da última tentativa rodada. `null` na faixa normal e no remux |
| Conversão | Aviso de imagem reduzida | Texto fixo: "A imagem do vídeo foi reduzida para caber no limite de 300 MB do PJe." |
| Conversão | Aviso de limite | Texto atual em `src/lib/upload-ffmpeg.ts` |
| Banner de recuperação | Aviso mostrado | `warning` de `UploadResult`, devolvido por `uploadRecoverySegments` e repassado por `useRecovery.finalizar` |

**Key invariants**:
- Toda gravação é salva, mesmo acima do limite.
- A redução só acontece quando o vídeo ficaria abaixo de 500 kbps.
- A resolução nunca aumenta.
- Quando há conversão, o vídeo nunca fica abaixo de 150 kbps.
- O caminho que apenas troca o contêiner (remux) continua sendo tentado primeiro, e o arquivo que cabe por ele não é reduzido.

**Security model**: sem mudança. A rota continua usando `assertGravacaoAccess`, modo `write`, contexto `upload`. Voz e imagem seguem como dados sensíveis, e nenhum dado novo é criado ou enviado para fora.

**Critical test scenarios**:
- Happy path: plano de 2 horas gera 480p, cerca de 275 kbps e áudio de 64 kbps, e um vídeo real de 2 horas fica em até 300 MB, verifies **AC-2**
- Sem regressão: plano de 30 e de 60 minutos igual ao atual, verifies **AC-1**
- Faixa e piso: 2h30 gera 360p, e 4 horas fica no piso, salva e avisa, verifies **AC-3**, **AC-4**
- Fonte pequena: fonte de 360p em plano de 480p não aumenta, verifies **AC-5**
- Avisos: os dois fluxos mostram o aviso de redução e o de limite, verifies **AC-6**, **AC-7**
- Nova tentativa: `retryConversion` devolve o mesmo aviso, verifies **AC-8**
- Falha: se a conversão reduzida falhar, o WebM é guardado para nova tentativa, como hoje, verifies **AC-8**
- Segunda tentativa: em 2 horas, com a primeira acima do limite, a altura continua 480, e a taxa sai do tamanho medido. No piso, ela não roda. Na faixa normal, cai para 480p quando o recálculo dá menos de 500 kbps, verifies **AC-11**
- Conteúdo difícil: vídeos de 2 horas, quase parado e com movimento, ficam em até 300 MB, verifies **AC-12**

## Build plan

1. Implementar as faixas da primeira tentativa em `upload-encoding.ts`, com testes de cada ponto de corte, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**
2. Aplicar escala e áudio mono nos dois modos de conversão em `upload-ffmpeg.ts`, sem aumentar a resolução, satisfies **AC-2**, **AC-3**, **AC-5**, **AC-9**
3. Calcular a segunda tentativa pelo tamanho medido e pulá-la no piso, satisfies **AC-4**, **AC-11**
4. Provar o caminho de ponta a ponta: converter dois vídeos de 2 horas, um quase parado e um com movimento, medir tamanho e tempo, e confirmar no ambiente real se `maxDuration = 300` em `src/app/api/upload/route.ts` interrompe a conversão, satisfies **AC-2**, **AC-12**
5. Devolver o aviso de redução e os novos campos de diagnóstico, inclusive no retorno do remux, com o aviso de limite tendo prioridade, satisfies **AC-4**, **AC-6**, **AC-8**
6. Mudar o retorno de `useRecovery.finalizar` e fazer o `RecoveryBanner` mostrar o `warning`, em vez de sempre mostrar sucesso, satisfies **AC-6**, **AC-7**
7. Gerar amostras com as regras de 2 horas, nos modos presencial e híbrido, para aprovação do dono do produto. Ajustar as faixas se reprovar, satisfies **AC-10**

## Consequences

**Positive**:
- Uma audiência de 2 horas passa a chegar ao PJe em um único arquivo, sem passos extras.
- O aviso de limite deixa de se perder no fluxo de recuperação.

**Negative / tradeoffs**:
- A imagem das gravações longas perde qualidade para sempre, e esse MP4 é a única cópia do vídeo.
- Em 2 horas, movimentos rápidos podem mostrar blocos, e rostos pequenos na mini janela do modo híbrido podem ficar difíceis de identificar. O AC-10 existe para avaliar isso.
- O aviso de redução só aparece ao finalizar. Depois disso, ninguém é informado na tela, nem o juiz.
- Se a duração informada for maior que a real, a gravação pode ser reduzida sem necessidade. Se for menor, a segunda tentativa corrige o tamanho, mas com uma conversão a mais.
- A segunda tentativa roda em um passo só, e em taxas baixas o tamanho varia mais. Por isso ela ainda pode passar do limite, e aí vale o aviso de limite.
- Se um dia for exigido texto legível na tela, esta decisão precisa ser revista.

**Neutral**:
- Gravações antigas acima de 300 MB continuam como estão, e a página de reprodução segue avisando.
- Nenhuma migração, variável de ambiente ou biblioteca nova.

## Follow-up

- [ ] Confirmar se o PJe aceita vários arquivos por audiência. Só importa se a amostra reprovar ou se a exigência de imagem mudar.
- [ ] Decidir se vale reconverter as gravações antigas acima de 300 MB, caso alguma precise ir ao PJe.
- [ ] Corrigir a estimativa `MP4 ~` em `RecordingScreen.tsx`, que usa a taxa de gravação e mostra cerca de 1,7 GB em 2 horas, para um arquivo final de até 300 MB.

Histórico da decisão em [rationale.md](rationale.md). Passos de verificação em [verify.md](verify.md).
