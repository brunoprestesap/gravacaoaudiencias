# Review, fix/webm-apagado-na-falha-da-conversao, 2026-11-02

**Reviewed by**: claude-sonnet-5-5 (modelo do autor não informado)
**Scope**: 9 files, branch vs main
**Verdict**: Approve with nits

## Summary
A mudança guarda o WebM em `conversoes-pendentes/<id>.<bytes>.webm` quando a conversão ou a gravação no banco falha. Permite tentar de novo sem novo envio (`mode=retryConversion`) e apaga o arquivo no sucesso ou na exclusão da gravação. A lógica está correta nos caminhos principais, a autorização é a mesma de antes e não há como escapar de `UPLOAD_DIR`. Rodei os testes de upload, do cliente e das rotas de gravação (75 passam) e o `tsc --noEmit` (limpo). Sobram pontos menores: uma corrida em tentativas simultâneas, um beco sem saída no cliente e a limpeza por prazo ainda em aberto.

## Minor
### 🟡 Duas tentativas simultâneas podem apagar o MP4 já convertido, `src/app/api/upload/route.ts:225`
**Problem**: no modo `retryConversion` duas requisições ao mesmo tempo (duplo clique, duas abas) leem o mesmo WebM e gravam o mesmo MP4. A primeira que termina atualiza o banco e apaga o WebM guardado. Se a segunda falhar, `keepWebmAfterFailure` compara com `gravacao.caminhoArquivo` lido antes da primeira terminar (ainda nulo), então apaga o MP4 bom. Depois `keepForRetry` tenta renomear um arquivo que não existe mais e dá erro.
**Why it matters**: o banco passa a apontar para um MP4 que não existe, e o WebM também sumiu. É um caso estreito, mas é perda de dado.
**Suggested fix**: impedir duas conversões da mesma gravação ao mesmo tempo (por exemplo, renomear o pendente para um nome de "em uso" antes de converter), ou reler `caminhoArquivo` do banco antes de decidir apagar o MP4. Na falha, tratar rename com arquivo ausente sem derrubar o fluxo.

### 🟡 Cliente sem saída quando a tentativa guardada falha sempre, `src/lib/upload-client.ts:167`
**Problem**: `uploadRecoverySegments` sempre tenta primeiro o WebM guardado e, se o servidor responder qualquer erro diferente de 404, lança sem enviar os segmentos. Se o WebM guardado for o problema (por exemplo, passou na sondagem mas o FFmpeg não converte), cada nova tentativa cai no mesmo caminho e o usuário nunca chega ao envio novo, mesmo com os chunks intactos no navegador.
**Why it matters**: o arquivo só sai por conversão bem sucedida ou exclusão. O usuário fica preso numa gravação que não finaliza.
**Suggested fix**: depois de uma falha da tentativa guardada, permitir o envio completo (por exemplo, na segunda falha seguida, ou com uma opção explícita de pular a tentativa). O envio completo já substitui o pendente (`keepForRetry` limpa os anteriores).

### 🟡 Limpeza "mais tarde" só existe por sucesso ou exclusão, `src/lib/conversao-pendente.ts:26`
**Problem**: o requisito do item 26 pede um caminho para limpar depois. Hoje o WebM (até 2 GB) só sai com conversão bem sucedida ou com `DELETE` da gravação. Gravação abandonada ocupa o disco para sempre. O `scope.md` registra isso como "needs a decision".
**Why it matters**: o requisito fica parcialmente atendido e o disco pode encher sem aviso.
**Suggested fix**: decidir o prazo e implementar uma varredura por idade da pasta `conversoes-pendentes`, ou confirmar com o dono do produto que a exclusão manual basta.

### 🟡 Erro inesperado deixa o WebM fora da pasta de pendentes, `src/app/api/upload/route.ts:428`
**Problem**: só falhas do transcode e do `prisma.update` chamam `keepWebmAfterFailure`. Qualquer outra exceção entre gravar o WebM e converter cai no `catch` geral, que deixa o WebM em `webmOutput.fullPath`, sem caminho de nova tentativa. Além disso, se `keepWebmAfterFailure` lançar (disco, permissão), o erro real do FFmpeg é substituído por um 500 genérico.
**Why it matters**: sobra a mesma situação de arquivo órfão que o item queria resolver, em casos raros.
**Suggested fix**: chamar a guarda também no `catch` geral quando o WebM já foi gravado, e proteger `keepWebmAfterFailure` com try/catch que registre o erro e preserve a resposta original.

## Nits
- ⚪ `src/lib/upload-client.ts:168`, toda finalização agora faz uma requisição extra antes do envio. É barato, mas vale um comentário dizendo que o 404 também cobre "gravação não encontrada".
- ⚪ `e2e/gravacao-fluxo.spec.ts:69`, o `route.abort` com `times: 1` agora derruba a sondagem `fetch` e não o XHR do envio. O teste continua válido, mas o comportamento exercitado mudou.

## Strengths
- A chave do arquivo inclui o tamanho de entrada, então uma gravação retomada (mais chunks) nunca reutiliza um WebM antigo sem o trecho novo, e há teste para isso.
- O MP4 de um envio anterior que deu certo não é apagado quando um novo envio falha (teste dedicado).
- O prefixo `${gravacaoId}.` evita apagar pendentes de gravações com ids parecidos, e a falha de limpeza depois do sucesso vira aviso e não erro.
- Autorização e resolução de caminho reaproveitam `assertGravacaoAccess` e `resolveUploadPath`; `inputBytes` é validado como inteiro seguro.

## Test coverage
Boa cobertura: a rota tem testes novos para falha de conversão, nova tentativa com sucesso e com falha, tamanho diferente, 404, tamanho inválido, substituição de pendente menor e falha de banco. O cliente e o `DELETE` têm testes, e o E2E cobre a tentativa guardada e a exclusão. Sem cobertura: tentativas simultâneas, falha em `keepForRetry` e o caminho do `catch` geral.
