# 0001. Redução automática do vídeo para o limite de 300 MB do PJe: histórico da decisão

Spec em [index.md](index.md).

## Context

O PJe recusa arquivos acima de 300 MB, regra firme confirmada pelo dono do produto. A meta do produto é gravar até 2 horas. O servidor baixa o MP4 e anexa no PJe à mão, porque o sistema não tem integração com ele.

`src/lib/upload-encoding.ts` nunca baixa o vídeo de 500 kbps, e `src/lib/upload-ffmpeg.ts` mantém a resolução de gravação (720p, 24 quadros por segundo). Por isso, cerca de 72 minutos é o máximo que cabe, e 2 horas dá cerca de 520 MB. Nesse caso o arquivo é salvo, mas o servidor só recebe um aviso e fica sem saída dentro do sistema.

Forças que moldam a decisão:

- Audiências acima de 70 minutos são raras, então a solução deve ser pequena.
- Ainda não sabemos se o PJe aceita vários arquivos por audiência.
- O requisito de imagem é manter rosto e gestos identificáveis. Texto legível na tela não é exigido.
- O MP4 é a única cópia do vídeo, porque o WebM é descartado depois da conversão. O WAV da transcrição fica ao lado e sai direto do WebM.

## Options considered

### Option 1: Reduzir só quando precisar

A conversão escolhe resolução e taxa pela duração e sai um único MP4.

**Pros**: nenhum passo a mais; não depende do PJe aceitar vários arquivos; mudança pequena, sem banco nem tela nova.
**Cons**: perda de imagem permanente nas gravações longas, e a qualidade em 2 horas ainda precisa ser provada.

### Option 2: Dividir em partes de até 300 MB

Mantém a qualidade atual, com vários arquivos por gravação.

**Pros**: melhor imagem, sem perda.
**Cons**: exige que o PJe aceite vários arquivos, o que não foi confirmado; muda o banco, o player, o download e a exclusão.

### Option 3: Melhorar só o aviso

A conversão fica como está, e a tela explica o problema.

**Pros**: quase sem código.
**Cons**: o servidor continua com um arquivo que o PJe recusa, e a meta de 2 horas segue sem caminho.

### Option 4: Guardar o original e criar uma cópia para o PJe

Mantém o arquivo de maior qualidade e gera outro, menor, para anexar.

**Pros**: preserva a imagem original.
**Cons**: cerca de 1,6 GB a mais por audiência de 2 horas, novo campo no banco e novas regras de exclusão, para um caso raro.

## Rationale

A raridade dos casos longos e a dúvida sobre vários arquivos eliminam a divisão: ela é a opção mais cara e a única que pode ser invalidada por um fato ainda desconhecido. Só o aviso não entrega a meta de 2 horas. Como o requisito é rosto e gestos, baixar a resolução é uma troca aceitável, e numa taxa baixa ela costuma dar imagem mais limpa do que manter 720p com blocos.

Guardar só o MP4 reduzido foi escolha consciente do dono do produto: a imagem original não pode ser recuperada, mas o WAV preserva o áudio. A qualidade em 480p é uma estimativa, por isso o AC-10 exige uma amostra aprovada por uma pessoa, e não só testes de tamanho.

Decisões de implementação tomadas nesta spec:

- **Áudio mono de 64 kbps nas faixas reduzidas**: em fala, uma voz só aproveita melhor a taxa. A alternativa, manter estéreo, gasta bits sem ganho em audiência.
- **Manter 24 quadros por segundo**: é a menor mudança. Baixar para 15 fica como primeiro ajuste, caso a amostra reprove.
- **Segunda tentativa pelo tamanho medido**: reavaliar as faixas com o multiplicador de hoje derrubaria 2 horas para 360p sem necessidade. Corrigir pelo tamanho real mantém a resolução e também compensa uma duração informada menor que a real. A alternativa, manter o multiplicador fixo, erra nos dois casos.
- **Sem medir a duração à parte**: os dois fluxos de envio já informam a duração, e `elapsedMs` não conta as pausas. A ordem atual fica: duração informada, depois sondagem, depois 30 minutos.
- **O piso de 150 kbps vence o limite da fonte**: uma fonte tão fraca provavelmente já cabe sem redução, e um piso único mantém a regra simples.
- **Altura resolvida no filtro de escala**: dispensa uma sondagem nova e mantém a altura par. A alternativa, devolver a altura em `probeMediaInfo`, só acrescentaria código.
- **Não unificar as quatro cópias de `PJE_MAX_OUTPUT_SIZE_BYTES`**: o limite é firme e não muda aqui. A unificação não é necessária para esta entrega.
