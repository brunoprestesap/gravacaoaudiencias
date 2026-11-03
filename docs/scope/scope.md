# Scope: Gravação de Audiências TRF1

Aplicação web para gravar e consultar audiências judiciais do TRF1, feita para não perder gravações. Atende servidores, que gravam, e juízes, que consultam.

**Build approach:** Tracer Bullet (cada item é feito de ponta a ponta e provado no app real).
**Workflow:** GA (depois de `/develop`: `/check verify`, `/test`, revisão por um modelo novo com `/check review`, e `/document`). É o padrão porque o sistema guarda registros judiciais e dados pessoais sensíveis. `/architect` é a primeira parada recomendada para um item com decisão real, mas você pode pular se já souber como construir. Qualquer item pode ter a própria etiqueta (por exemplo `· Beta`) para fazer mais ou menos.

_Isto são recomendações para manter o trabalho em ordem, não obrigações. Pule o que não fizer sentido. Você decide quando um item está `done`._

## At a glance

| # | Item | Fase | Status |
|---|------|------|--------|
| A | Autenticação e papéis | Existente | existing |
| B | Gravação presencial, híbrida e multicâmera | Existente | existing |
| C | Recuperação de gravação interrompida | Existente | existing |
| D | Upload e conversão para MP4 | Existente | existing |
| E | Consulta e reprodução | Existente | existing |
| F | Transcrição em lote | Existente | existing |
| G | Transcrição ao vivo (desligada por padrão) | Existente | existing |
| H | Termo de audiência | Existente | existing |
| 1 | Acesso a arquivos fora de `UPLOAD_DIR` | Correções concluídas | done |
| 2 | Perda de vídeo nos modos híbrido e multicâmera | Correções concluídas | done |
| 3 | Queda de dispositivo e pouco espaço em disco | Correções concluídas | done |
| 4 | Registro da gravação ausente no upload | Correções concluídas | done |
| 5 | Termo travado em `PROCESSANDO` | Correções concluídas | done |
| 6 | Avisos na tela de retomada | Correções concluídas | done |
| 7 | Limpeza apagando falas legítimas | Correções concluídas | done |
| 8 | Transcrição ao vivo e papel inferido | Correções concluídas | done |
| 9 | Conferir caminhos suspeitos nos ambientes | Fatia 1 | planned |
| 10 | Duração correta após retomar | Fatia 1 | done |
| 11 | Conversões longas interrompidas pelo limite de saída | Fatia 1 | done |
| 26 | WebM apagado quando a conversão falha | Fatia 1 | done |
| 12 | Validação na sala piloto | Fatia 2 | planned |
| 13 | Limite de 300 MB do PJe em gravações longas | Fatia 2 | in-progress |
| 14 | Transcrição travada ou duplicada | Fatia 3 | planned |
| 15 | Limite de processos FFmpeg na transcrição | Fatia 3 | planned |
| 16 | Reprocessar gravações antigas | Fatia 3 | planned |
| 17 | Salvamento do termo sem perda silenciosa | Fatia 4 | planned |
| 18 | Hora da audiência no termo | Fatia 4 | planned |
| 19 | Evitar cobrança dupla do termo | Fatia 4 | planned |
| 20 | Vara em texto livre | Fatia 5 | planned |
| 21 | Permissões do juiz na consulta | Fatia 5 | planned |
| 22 | Autorizar o upload antes de ler o corpo | Fatia 5 | planned |
| 23 | Listagem de gravações mais leve | Fatia 5 | planned |
| 24 | Painel "Status do Sistema" real | Fatia 5 | planned |
| 25 | Avaliação LGPD dos serviços externos | Fatia 6 | planned |

## O que já existe

Enviados antes deste scope, listados só para dar contexto.

### A. Autenticação e papéis · existing
Login com usuário e senha, sessão JWT, papéis `SERVIDOR` e `JUIZ`, regra de acesso central. Código em `src/lib/auth.ts`, `src/lib/gravacao-access.ts`, `src/middleware.ts`.

### B. Gravação presencial, híbrida e multicâmera · existing
Captura pelo navegador, com chunks de 5 s salvos no IndexedDB. Código em `src/components/recording/`, `src/hooks/useMediaRecorder.ts`, `src/lib/media-utils.ts`.

### C. Recuperação de gravação interrompida · existing
O banner do painel oferece retomar ou finalizar. Não há botão para descartar. Código em `src/hooks/useRecovery.ts`, `src/components/recording/RecoveryBanner.tsx`.

### D. Upload e conversão para MP4 · existing
Junta os segmentos, valida, extrai o WAV e converte visando 300 MB. Código em `src/app/api/upload/route.ts`, `src/lib/upload-ffmpeg.ts`, `src/lib/upload-encoding.ts`.

### E. Consulta e reprodução · existing
Lista paginada, busca por processo, player e download. Código em `src/app/(auth)/consulta/`, `src/app/(auth)/gravacao/[id]/reproduzir/`.

### F. Transcrição em lote · existing
Seis motores, limpeza e inferência de papéis. Código em `src/lib/transcription-local/`, `src/lib/transcription-cleanup.ts`, `src/lib/transcription-diarization.ts`.

### G. Transcrição ao vivo (desligada por padrão) · existing
Só liga com `NEXT_PUBLIC_LIVE_TRANSCRIPTION_ENABLED=true`, porque o navegador envia o áudio ao fornecedor. Código em `src/hooks/useSpeechRecognition.ts`, `src/hooks/useLiveTranscription.ts`.

### H. Termo de audiência · existing
Geração pela Maritaca, edição e exportação em PDF e DOCX. Código em `src/lib/termo-audiencia/`, `src/components/termo/`.

## Correções concluídas

Encontradas na análise do projeto e já na `main`.

### 1. Acesso a arquivos fora de `UPLOAD_DIR` · done
`caminhoArquivo` não vem mais do cliente, o `id` é validado e `resolveUploadPath` protege as rotas que usam o disco. PR #4.

### 2. Perda de vídeo nos modos híbrido e multicâmera · done
Temporizador em Web Worker, e "Retomar com Câmera" troca mesmo de stream. PR #5.

### 3. Queda de dispositivo e pouco espaço em disco · done
Aviso para retomar ou encerrar, e armazenamento persistente. PR #6.

### 4. Registro da gravação ausente no upload · done
`ensureGravacaoRecord` antes de cada upload, e primeiro E2E do fluxo completo. PR #7.

### 5. Termo travado em `PROCESSANDO` · done
Tempo limite na Maritaca, recuperação no boot e detecção de estado obsoleto. PR #8.

### 6. Avisos na tela de retomada · done
Página movida para o grupo `(auth)`, com E2E da recuperação. PR #9.

### 7. Limpeza apagando falas legítimas · done
Regras exigem evidência de loop, e números ditados não colapsam. PR #10.

### 8. Transcrição ao vivo e papel inferido · done
Quatro defeitos corrigidos, com a função desligada por padrão. PR #11.

## Fatia 1: Corrigir antes do piloto

Uma conferência rápida e três correções pequenas, para o piloto medir o produto sem tropeçar em falhas já conhecidas.

### 9. Conferir caminhos suspeitos nos ambientes
Tarefa de operação, sem código. O PR #4 fechou a falha, mas um registro antigo pode indicar uma tentativa de ataque.
**Done when:** a consulta rodou em cada ambiente e qualquer resultado foi investigado.
- [ ] Rodar em cada ambiente a consulta somente leitura abaixo
  ```sql
  SELECT id, "caminhoArquivo" FROM "Gravacao"
  WHERE "caminhoArquivo" LIKE '%..%' OR id !~ '^[A-Za-z0-9_-]{1,100}$';
  ```

### 10. Duração correta após retomar · done
Ao retomar, o timer volta a zero e a `duracao` salva conta só o último trecho. Esse valor também alimenta o cálculo de bitrate, então o arquivo pode sair maior que o previsto. Ficou mais frequente com o botão Retomar do item 3.
**Done when:** depois de retomar, o timer, a `duracao` salva e o cálculo de bitrate consideram todos os trechos.
- [x] Corrigir: `/debug duração após retomar`

PR #13.

### 11. Conversões longas interrompidas pelo limite de saída · done
`execFileAsync` em `src/lib/upload-ffmpeg.ts` usa o `maxBuffer` padrão de 1 MB. O FFmpeg roda sem `-nostats` e escreve progresso sem parar, então um passo com cerca de 43 minutos de relógio era encerrado no meio (medido com progresso acelerado).
**Done when:** uma conversão longa termina sem ser interrompida pelo limite de saída, com teste que prove isso.
- [x] Reproduzir e corrigir: `/debug conversões longas`

PR #14.

### 26. WebM apagado quando a conversão falha · done
O `finally` em `src/app/api/upload/route.ts` apaga o WebM mesmo quando a conversão falha, e o servidor responde 500. A cópia que sobra são os chunks no navegador, então tentar de novo exige o mesmo perfil do navegador e repete todo o envio e a conversão.
**Done when:** uma conversão que falha deixa o WebM no servidor, com um caminho para tentar de novo sem novo envio, e um caminho para limpá-lo depois.
- [x] Corrigir: `/debug WebM apagado quando a conversão falha`

PR #15.

## Fatia 2: Provar o que foi corrigido e decidir o limite do PJe

O resultado pode mudar a prioridade de tudo abaixo.

### 12. Validação na sala piloto
Os testes usaram dispositivos falsos. Só o hardware real prova as correções de gravação, que são a hipótese central do produto.
**Done when:** os quatro cenários abaixo rodaram com hardware real, e cada falha virou um item neste scope.
- [ ] 2 horas no modo híbrido com o Teams na frente, encerrando o compartilhamento no meio
- [ ] Puxar o cabo do microfone e o da câmera durante a gravação, e retomar, conferindo qual microfone foi usado
- [ ] Conferir se o armazenamento persistente é concedido no perfil real do navegador
- [ ] Aba oculta por mais de 5 minutos, conferindo os quadros gravados

### 13. Limite de 300 MB do PJe em gravações longas · in-progress
O piso de 500 kbps impede que gravações acima de cerca de 70 minutos caibam em 300 MB. A meta do produto é 2 horas, que dá cerca de 510 MB. As opções são aceitar o aviso atual, dividir em partes ou reduzir mais a qualidade. Código em `src/lib/upload-encoding.ts`.
**Done when:** uma gravação de 2 horas tem um caminho claro até o PJe, e o usuário sabe o que fazer com ela.
- [x] Design it (spec): `/architect limite de 300 MB do PJe`
- [ ] Build it: `/develop limite de 300 MB do PJe`
   - [x] Faixas de redução, escala e segunda tentativa pelo tamanho medido (AC-1..5, AC-9, AC-11)
   - [x] Avisos nos dois fluxos, inclusive no banner de recuperação (AC-6..8)
   - [ ] Prova com vídeos reais de 2 horas: tamanho e tempo de conversão (AC-2, AC-12)
   - [ ] Amostra aprovada por você, nos modos presencial e híbrido (AC-10)
- [ ] Verify it: `/check verify limite de 300 MB do PJe`
- [ ] Test it: `/test limite de 300 MB do PJe`
- [ ] Review it (fresh model): `/check review limite de 300 MB do PJe`
- [ ] Document it: `/document limite de 300 MB do PJe`

Spec [0001](../specs/0001-reducao-video-limite-pje/index.md).

## Fatia 3: Transcrição

### 14. Transcrição travada ou duplicada · needs a decision
Nenhum subprocesso tem tempo limite, e o botão em `/consulta` fica desabilitado em `PROCESSANDO`, então uma transcrição travada só sai com reinício do servidor. Depois de 30 minutos, o `POST` aceita rodar de novo, mas uma transcrição longa legítima pode levar horas, e aí duas rodam ao mesmo tempo. A decisão é qual tempo limite usar, porque depende do motor e da duração do áudio. Código em `src/lib/transcricao-recovery.ts`, `src/app/api/gravacoes/[id]/transcricao/route.ts`.
**Done when:** uma transcrição travada vira `ERRO` sozinha e pode ser refeita pela tela, e duas nunca rodam ao mesmo tempo na mesma gravação.
- [ ] Design it (spec): `/architect transcrição travada ou duplicada`

### 15. Limite de processos FFmpeg na transcrição
`extractSegmentVoiceFeatures` em `src/lib/voice-features.ts` abre vários processos por segmento, todos de uma vez. Em uma audiência longa, pode esgotar o servidor, e as falhas viram silenciosamente características globais de voz.
**Done when:** uma audiência longa transcreve com um número limitado de processos simultâneos, sem piorar a inferência de papéis.
- [ ] Corrigir: `/debug limite de processos FFmpeg`

### 16. Reprocessar gravações antigas · needs a decision
As transcrições feitas antes do PR #10 passaram pela limpeza antiga e podem ter perdido falas e números ditados. Termos gerados a partir delas podem ter herdado a perda. Transcrever de novo substitui o texto atual e, no motor `google`, tem custo.
**Done when:** você decidiu quais processos reprocessar, e os termos afetados foram revisados.
- [ ] Design it (spec): `/architect reprocessar gravações antigas`

## Fatia 4: Termo de audiência

### 17. Salvamento do termo sem perda silenciosa
Se o salvamento automático falha, o usuário não é avisado. Sair da tela no intervalo do debounce descarta a última edição, e exportar logo após editar pode usar o texto antigo. Código em `src/components/termo/hooks/useTermoAutoSave.ts`, `src/components/termo/TermoEditor.tsx`.
**Done when:** uma falha ao salvar aparece na tela, sair da tela não perde a última edição, e o export usa o texto mais recente.
- [ ] Corrigir: `/debug salvamento do termo`

### 18. Hora da audiência no termo
O prompt pede `{hora}`, mas `toProcessMetadata` envia só a data, então o modelo não tem essa informação e pode inventá-la. O corte da data em UTC também pode mudar o dia. Código em `src/app/api/gravacoes/[id]/termo/route.ts`, `src/lib/termo-audiencia/prompt.ts`.
**Done when:** o termo usa a data e a hora informadas, sem inventar valores.
- [ ] Corrigir: `/debug hora da audiência no termo`

### 19. Evitar cobrança dupla do termo
Dois cliques simultâneos podem passar pela checagem do `POST` e gerar duas chamadas pagas à Maritaca, porque a checagem e a atualização são separadas.
**Done when:** dois pedidos simultâneos resultam em uma única chamada à Maritaca.
- [ ] Corrigir: `/debug cobrança dupla do termo`

## Fatia 5: Acesso e consulta

### 20. Vara em texto livre · needs a decision
A vara é digitada à mão e é a chave de acesso do juiz, então um erro de digitação esconde a gravação dele, e um servidor pode atribuí-la a outra vara. A decisão é entre lista fechada, vara do usuário logado ou outro modelo.
**Done when:** toda gravação nova chega ao juiz certo, e existe um caminho para corrigir as antigas.
- [ ] Design it (spec): `/architect vara em texto livre`

### 21. Permissões do juiz na consulta · needs a decision
O juiz vê botões de excluir, que falham com 403, e de nova gravação, além de poder disparar uma transcrição, que tem custo no motor `google`. Falta decidir se ele pode transcrever.
**Done when:** o juiz vê só as ações permitidas, e a regra de transcrição está decidida e aplicada na API e na tela.
- [ ] Design it (spec): `/architect permissões do juiz na consulta`

### 22. Autorizar o upload antes de ler o corpo
`POST /api/upload` lê todo o corpo, de até 2 GB ou mais, antes de checar o limite e a permissão. Qualquer usuário logado pode consumir memória do servidor com um envio grande.
**Done when:** um envio sem permissão é recusado antes de o corpo ser lido, e o limite de tamanho vale antes de ocupar a memória.
- [ ] Corrigir: `/debug autorizar upload antes de ler o corpo`

### 23. Listagem de gravações mais leve
`GET /api/gravacoes` devolve a transcrição completa de cada linha, com as características de voz, e repete isso a cada 4 s durante o polling. A tela só usa os papéis.
**Done when:** a listagem traz só o que a tela usa, e a página continua mostrando as mesmas informações.
- [ ] Corrigir: `/debug listagem de gravações`

### 24. Painel "Status do Sistema" real · needs a decision
O painel do dashboard mostra armazenamento em 45% e "Online" com valores fixos no código, o que pode enganar. A decisão é entre remover ou medir de verdade.
**Done when:** o painel mostra dados reais, ou deixa de existir.
- [ ] Design it (spec): `/architect painel status do sistema`

## Fatia 6: Conformidade

### 25. Avaliação LGPD dos serviços externos · needs a decision
O motor `google` envia áudio para `us-central1`, o termo vai para a Maritaca e, se ligada, a transcrição ao vivo envia áudio ao fornecedor do navegador. O `BLUEPRINT.md` trata voz e imagem como dados sensíveis. A decisão é do tribunal, e pode mudar o motor padrão e a configuração dos ambientes.
**Done when:** o tribunal registrou o que é permitido, e os ambientes estão configurados conforme essa decisão.
- [ ] Levar a avaliação ao tribunal e registrar a decisão: `/architect avaliação LGPD`

## Deferred

Fora desta passada. Encontrados na análise por leitura de código, sem reprodução, então vale confirmar cada um antes de corrigir.

- **Descartar gravação interrompida**: o banner não oferece descartar, embora `useRecovery.dismiss` exista.
- **Segunda aba durante a gravação**: abrir o dashboard em outra aba marca a gravação em curso como interrompida e permite finalizá-la.
- **Corrida ao salvar chunks**: dois `saveChunk` sobrepostos podem usar o mesmo índice, e o último chunk pode ficar de fora ao encerrar.
- **Arquivos órfãos no upload**: se a junção dos segmentos ou a escrita do WebM falham no meio (por exemplo, disco cheio), o arquivo parcial fica no disco.
- **Tentar a conversão pela Consulta**: a nova tentativa do item 26 parte do navegador que tem os chunks. Se eles se perderam, o WebM fica guardado no servidor, mas só um operador consegue convertê-lo.
- **Prazo para o WebM guardado**: ele só sai com uma conversão que dá certo ou com a exclusão da gravação, e pode ter até 2 GB · needs a decision.
- **Range no stream**: a rota `stream` não limita o fim do intervalo ao tamanho do arquivo.
- **Login sem limite de tentativas**: não há proteção contra tentativas repetidas · needs a decision.
- **Papel e vara em cache no JWT**: mudanças só valem depois de um novo login · needs a decision.
- **Validação no `POST /api/gravacoes`**: `modo` e o número do processo não são validados no servidor.
- **Microfone da transcrição ao vivo**: se ligada, usa o microfone padrão do sistema, não necessariamente o selecionado.
- **Vários arquivos por audiência no PJe**: confirmar se é aceito. Só importa se a amostra da spec 0001 reprovar ou se a exigência de imagem mudar · from spec 0001.
- **Gravações antigas acima de 300 MB**: decidir se vale reconverter, caso alguma precise ir ao PJe · needs a decision · from spec 0001.
- **Estimativa `MP4 ~` na gravação**: usa a taxa de gravação e mostra cerca de 1,7 GB em 2 horas, para um arquivo final de até 300 MB · from spec 0001.

## Legend

**A caixa de decisão.** O item que `needs a decision` carrega uma subtarefa terminada em `(spec)`. As demais são caixas de execução.

- **Próximo passo** = a primeira caixa sem marca.
- **needs a decision** = rode `/architect` primeiro; a etiqueta sai quando a spec é registrada. Nos demais, a entrada é `/debug` ou `/develop`.
- **As tarefas detalhadas ficam na seção `## Build plan` da spec**, não aqui.
- **Status** `planned` → `in-progress` → `done`, além de `existing` (anterior a este fluxo) e `dropped` (fora do escopo, mantido como histórico).
- **Etiqueta de workflow** ao lado de um título (por exemplo `· Beta`) muda o rigor só daquele item; sem etiqueta, vale o padrão.
- **Workflow** é o que roda depois de `/develop`: **Prototype** = nada; **Alpha** = `/check verify`; **Beta** = `/check verify` e `/test`; **GA** = também `/check review` e `/document`.
