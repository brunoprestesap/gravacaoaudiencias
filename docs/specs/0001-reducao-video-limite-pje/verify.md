# Verify: Limite de 300 MB do PJe · spec 0001 · updated 2026-11-02
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Enviar uma gravação de 30 min → 720p, 96 kbps de áudio, sem aviso → AC-1
- [ ] Enviar uma gravação real de 2 horas → 480p, até 300 MB, com aviso de imagem reduzida na tela → AC-2, AC-6
- [ ] Enviar uma gravação de 2h30 → 360p, pelo menos 150 kbps de vídeo, até 300 MB → AC-3
- [ ] Enviar uma gravação de mais de 3h10 → salva no piso, com `apto: false` e aviso de limite → AC-4, AC-7
- [ ] Enviar uma fonte menor que 480p com duração de 2 horas → a resolução não aumenta → AC-5
- [ ] Finalizar uma gravação longa pelo banner de recuperação → aviso no lugar do sucesso, tanto de redução quanto de limite → AC-6, AC-7
- [ ] Fazer a conversão falhar e usar `mode=retryConversion` → mesmas regras e mesmo aviso → AC-8
- [ ] Conferir o WAV de uma gravação reduzida → mono, 16 kHz, duração cheia → AC-9
- [ ] Forçar a primeira tentativa acima do limite → mantém a altura da faixa, e a taxa sai do tamanho medido → AC-11
- [ ] Converter dois vídeos reais de 2 horas no servidor real, passando pelo proxy de produção → até 300 MB, sem interrupção, com tempo aceito pelo dono do produto → AC-2, AC-12
- [ ] Conferir no proxy de produção o tempo limite de resposta e o tamanho máximo do corpo → aceitam cerca de 6 min de conversão e cerca de 2 GB de envio → AC-12
- [ ] Assistir às amostras de 2 horas nos modos presencial e híbrido → rosto e gestos identificáveis, com aprovação do dono do produto → AC-10

## Value sourcing
- [ ] Enviar com `duracao` e sem `duracao` → com o campo, a faixa sai dele; sem o campo, sai da sondagem → Duração
- [ ] Enviar a mesma duração com fontes de taxa baixa e alta → faixa igual, e o vídeo respeita 95% da taxa da fonte, com piso de 150 kbps → Orçamento, Taxa da fonte
- [ ] Conferir `encoding` na resposta da conversão reduzida, da normal e do remux → `qualityReduced` e `maxHeight` conforme a última tentativa rodada; `false` e `null` na normal e no remux → `qualityReduced`, `maxHeight`
- [ ] Conferir o texto do `warning` nos dois fluxos → aviso de limite tem prioridade sobre o de redução → Avisos
- [ ] Enviar uma duração menor que a real → a segunda tentativa usa o `bytes1` medido → `bytes1`

## Commands
- [ ] `npx vitest run src/lib/upload-encoding.test.ts src/lib/upload-ffmpeg.test.ts src/components/recording/RecoveryBanner.test.tsx` → tudo passa → AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-11
- [ ] `npx playwright test e2e/upload.spec.ts` → passa, com o Postgres E2E ligado → sem regressão no upload

## Acceptance-criteria coverage
- AC-1: gravação de 30 min, testes de unidade · AC-2: gravação de 2 horas · AC-3: gravação de 2h30 · AC-4: mais de 3h10 · AC-5: fonte pequena · AC-6 e AC-7: fim da gravação e banner · AC-8: `retryConversion` · AC-9: WAV · AC-10: amostras · AC-11: primeira tentativa acima do limite · AC-12: vídeos reais e proxy

## Medição sintética de 2026-11-02 (referência, não substitui os passos acima)
Dois vídeos de 2 horas, com 4 minutos repetidos, em um M1 Pro carregado: quase parado 295,2 MB em 5 min 41 s; com movimento 295,7 MB em 6 min 9 s. Uma tentativa só nos dois casos.
