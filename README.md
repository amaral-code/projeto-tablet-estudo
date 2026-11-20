# 📒 Caderno de Estudos

Caderno digital para estudar no **REDMI Pad 2** com a Redmi Smart Pen (ou com o dedo), no estilo do Mi Canvas. Ele também **corrige letras e números escritos à mão** e **confere contas**.

Funciona como aplicativo instalado (PWA): abre em tela cheia, funciona **sem internet** e guarda tudo no próprio tablet.

## 📲 Abrir e instalar no tablet (sem computador)

Tudo pelo **Google Chrome do tablet**, uma vez só:

1. Abra **github.com/amaral-code/projeto-tablet-estudo** (entre na sua conta do GitHub).
2. Toque na aba **Settings** (Configurações). Se ela não aparecer, toque em **⋮ → Site para computador** no Chrome.
3. No menu da esquerda, toque em **Pages**.
4. Em *Build and deployment*, deixe **Source: Deploy from a branch**. Em **Branch**, escolha **`claude/beautiful-hypatia-qivm75`** e a pasta **`/ (root)`**. Toque em **Save**.
5. Espere 1 ou 2 minutos e abra **https://amaral-code.github.io/projeto-tablet-estudo/**
6. No Chrome, toque em **⋮ → Instalar app** (ou **Adicionar à tela inicial**).

Pronto: o ícone **Caderno** aparece na tela inicial e abre em tela cheia. As próximas melhorias enviadas para esse branch entram sozinhas, basta abrir o app com internet.

> Na primeira vez, abra o app com internet para ele ficar guardado e funcionar offline depois. Segure o ícone do app para ver os atalhos: Hoje, Começar foco, Nova anotação e Leitura.

## 🧭 Onde fica cada coisa

O app tem **3 áreas**, sempre no menu da esquerda (tablet deitado) ou em **Mais** na barra de baixo (tablet em pé):

| Área | Telas |
|---|---|
| 🗓️ **Planejar** | **Hoje** (seu dia em uma tela, com "O que fazer agora") · **Tarefas** (lista, quadro e matriz) · **Notas rápidas** · **Agenda** (mês) · **Horário de aulas** · **Metas** |
| 📚 **Estudar** | **Caderno** (anotações à mão + IA + gravação da aula) · **Foco** (Pomodoro e cronômetro) · **Flashcards** · **Simulado** (prova feita pela IA) · **Tutor IA** · **Leitura** (com Kindle) |
| 📈 **Acompanhar** | **Hábitos** · **Diário** · **Notas e provas** · **Relatório** (semana, mapa do ano, conquistas e análise da IA) |

No fim do menu ficam **Tudo e ajuda**, **Dados e backup** e **Ajustes e IA**.

- **Menu retrátil:** com o tablet deitado, toque na setinha **‹** ao lado do nome do app (ou no **☰**) para o menu virar uma coluna fina só com ícones e nomes curtos. Toque de novo para abrir. O app lembra como você deixou. Com o tablet em pé, o menu é uma gaveta: toque no **☰** ou **arraste da borda esquerda** para abrir, e arraste para a esquerda (ou toque fora) para fechar.
- O botão azul **+** no canto cria qualquer coisa de qualquer tela (anotação, nota rápida, tarefa, gravar aula, perguntar ao tutor, foco…), e no topo da lista aparece a ação da tela em que você está.
- A tela **Tudo e ajuda** mostra cada recurso com uma frase dizendo para que serve, e tem o **tour** de boas-vindas.
- Cada tela mostra uma **dica curta** no topo até você tocar em "Entendi". O nome da área aparece acima do título, então você sempre sabe onde está.

## 🆕 Novidades desta versão

| Recurso | O que faz |
|---|---|
| ✍️ **Escrita organizada** | No editor, em **Auto → Escrita organizada**: escreva em qualquer parte da folha e, ao parar, sua letra vira texto em **fonte manuscrita** nas linhas, emendado no fim da linha. Cada **ponto final** começa um parágrafo novo na linha de baixo. No menu ao lado você escolhe a **fonte** (6 manuscritas: Caveat, Patrick Hand, Indie Flower, Kalam, Shadows Into Light e Dancing Script, ou digitada), o **tamanho** e o **recuo do parágrafo**; a **cor** é a da caneta escolhida em cima. Se a folha encher, o texto continua na página seguinte. Funciona sem internet só para as fontes: o reconhecimento da letra precisa de internet |
| ☰ **Menu lateral retrátil** | Recolhe para só ícones e deixa mais espaço para estudar; com o tablet em pé, abre arrastando da borda |
| ⚡ **IA só com o Gemini rapidão** | Uma chave só, sem escolher provedor. Usa o **Gemini Flash-Lite**, o mais rápido do Google: **0,8 s** para responder um texto e **2 s** para ler uma página do caderno nos testes de verdade |
| 💬 **Tutor IA** | Converse com a IA como com um professor particular. Mande a **foto de um exercício** (câmera do tablet) e ela resolve passo a passo. Fale em vez de digitar (🎙️ ditado) e ouça a resposta (🔊). As conversas ficam salvas e aparecem na busca |
| 🎙️ **Gravar a aula** | No caderno, toque no 🎙️ do topo (ou **+ → Gravar aula**) para gravar o áudio enquanto escreve. A gravação fica ligada à anotação e é salva aos poucos (se o app fechar, não perde). Depois, a IA faz o **resumo da aula**, a **transcrição** ou tira as **tarefas e datas** que o professor falou, e escreve tudo na anotação |
| 📌 **Notas rápidas** | Ideias e lembretes estilo post-it, com cores, **listas de marcar**, ditado por voz e leitura em voz alta. Fixe no Hoje com 📌 e transforme os itens em tarefas com um toque |
| 💡 **O que fazer agora** | No topo do Hoje: a aula que está acontecendo, provas chegando, tarefas atrasadas, prioridades, flashcards para revisar, meta de foco, hábitos e diário — cada sugestão com o botão que já começa |
| 🗓️ **Mapa de estudos do ano** | No Relatório, cada dia do último ano pintado conforme o quanto você estudou. Toque num dia para ver os detalhes |
| 🗄️ **Dados e backup** | O banco de dados do app à vista: o que está salvo, espaço usado, **proteção contra o Android apagar**, **cópias automáticas diárias** dentro do app (volta no tempo com um toque), backup em arquivo (com as gravações), **verificar e reparar** |
| 🔊 **Ouvir e ditar** | Botão **Ouvir** nas respostas da IA, no tutor, nas notas rápidas e nos flashcards; **Ditar** nas notas rápidas e no tutor |
| 🔍 **Busca por dentro** | A lupa agora acha o **texto** de anotações, notas rápidas, conversas do tutor, subtarefas e flashcards, mostrando o trecho |
| ↩️ **Desfazer** | Apagou uma tarefa ou nota rápida sem querer? Toque em **Desfazer** no aviso |

## 🚀 Tudo em um: central de produtividade

O app abre na tela **Hoje** e junta, num só lugar, os recursos mais úteis dos apps de produtividade:

| Seção | O que faz |
|---|---|
| 🏠 **Hoje** | Painel do dia com saudação, **sequência de dias estudando 🔥**, tarefas de hoje e atrasadas, próximos 7 dias, minutos de foco e meta diária, flashcards para revisar, hábitos do dia e as últimas anotações para continuar |
| ⏱️ **Foco (Pomodoro)** | Ciclos de 25 min de foco com pausas de 5 e 15 min, todos ajustáveis. Você escolhe a matéria e a tarefa. Avisa com som, vibração e notificação, e mantém a tela acesa. Um **relógio flutuante** continua visível enquanto você escreve no caderno. Mostra estatísticas: hoje, últimos 7 dias, gráfico por dia e tempo por matéria |
| 📅 **Agenda** | Calendário do mês com as tarefas de cada dia, os minutos de foco e os hábitos feitos. Toque num dia para ver os detalhes ou criar uma tarefa nele |
| 🃏 **Flashcards** | Baralhos com **repetição espaçada**: as cartas que você erra voltam logo, e as que você sabe aparecem cada vez mais espaçadas (Errei / Difícil / Bom / Fácil). A **IA cria as cartas** a partir das suas anotações |
| 🔥 **Hábitos** | Marque o que fez em cada dia da semana e acompanhe a sequência de cada hábito |
| ✅ **Tarefas** | Agora com **repetição** (todo dia, toda semana ou todo mês): ao concluir uma, a próxima é criada sozinha |

## ⚡ Mais produtividade

| Recurso | O que faz |
|---|---|
| 🗓️ **Horário de aulas** | Grade da semana. O painel Hoje mostra a aula de **agora** e a **próxima**. **Anotar nesta aula** cria a anotação na pasta da matéria com a data. Dá para repetir uma aula de segunda a sexta |
| 📋 **Tarefas em 3 visões** | **Lista**, **Quadro** (A fazer, Fazendo, Feito) e **Matriz de prioridades** (urgente × importante), além de **subtarefas** com progresso (ex.: 2/5) |
| 🎧 **Sons de foco** | Ruído branco, rosa, marrom e chuva, gerados no tablet e funcionando sem internet. Tocam só durante o foco, com volume ajustável |
| 🖥️ **Modo tela cheia** | Na tela de Foco, esconde tudo e deixa só o relógio, sem distrações |
| 📔 **Diário de estudos** | Seu humor, o que aprendeu, o que foi difícil e o plano para amanhã. O que foi difícil vira tarefa de revisão, e a IA faz o **resumo do mês** |
| 🔁 **Revisão espaçada** | As anotações novas voltam para revisão depois de 1, 3, 7, 14 e 30 dias e aparecem em "Revisar hoje". Dá para ligar ou desligar pelo menu ⋮ da anotação |

## 📈 Desempenho

| Seção | O que faz |
|---|---|
| 📚 **Leitura + Kindle** | Botão **Abrir app Kindle** (e Kindle na web). Cadastre os livros, registre até onde leu e veja a % lida, a previsão de quando termina no seu ritmo, a meta diária de páginas e a sequência de dias lendo. Guarde **citações** e transforme qualquer uma em flashcard. Registrar leitura marca sozinho o seu hábito de leitura |
| 🎓 **Notas e provas** | Lance notas com peso por matéria e veja a **média**, a meta e **quanto precisa tirar na próxima prova**. Cadastre provas futuras com **contagem regressiva** (aparecem em Hoje e na Agenda) e gere um **plano de revisão** que cria as tarefas até o dia da prova |
| 📊 **Relatório semanal** | Foco, tarefas, flashcards, páginas, hábitos e atrasos comparados com a semana anterior. Mostra seu melhor dia e as matérias esquecidas. Com **Analisar minha semana com IA**, você recebe conselhos e tarefas para a semana seguinte |
| 🏆 **Nível e conquistas** | Você ganha XP estudando (foco, tarefas, cartas, páginas, livros, hábitos) e libera 12 conquistas |
| 🔗 **Atalhos de apps** | Kindle, Classroom, Drive, YouTube, Tradutor e Khan Academy, todos editáveis. No tablet abrem o app instalado; se não conseguirem, abrem o site |
| 🔍 **Busca rápida** | A lupa no topo (ou Ctrl+K num teclado) encontra anotações, tarefas, notas rápidas, conversas, livros, pastas e baralhos — pelo título ou pelo texto de dentro — e executa ações como "Começar foco", "Gravar a aula" e "Abrir Kindle" |
| ⭐ **Prioridades de hoje** | Toque na estrela de até 3 tarefas: elas ficam no topo do painel Hoje |
| 🎯 **Metas** | Horas de foco, páginas, livros, flashcards, tarefas, dias de um hábito, média numa matéria ou um contador seu, com progresso **calculado sozinho** e o ritmo necessário |
| 📝 **Simulado com IA** | A IA monta uma prova de múltipla escolha das suas anotações, corrige com explicação, lança a nota e transforma os erros em flashcards |
| 📲 **Atalhos no ícone** | Segure o ícone do app na tela inicial para abrir direto em Hoje, Começar foco, Nova anotação ou Leitura |

## ✦ Assistente de IA (Gemini rapidão)

Toque no botão roxo **IA** dentro de uma anotação. A IA **lê a sua letra direto da folha**, sem precisar converter antes. Escolha **Seleção**, **Esta página** ou **Todas** e peça:

| Ação | O que faz |
|---|---|
| **Resumir** | Resumo de estudo com ideias principais, conceitos e "Para lembrar" |
| **Melhorar a escrita** | Reescreve corrigindo ortografia, acentuação, gramática e clareza, e explica cada correção ("errado → certo") |
| **Escrever mais** | Aprofunda a matéria com explicações, exemplos e detalhes que faltam |
| **Explicar passo a passo** | Explica como um professor e resolve os exercícios mostrando onde você errou |
| **Perguntas de revisão** | 10 perguntas, da mais fácil para a mais difícil, com gabarito |
| **Flashcards** | Cartas de pergunta e resposta. Um toque salva tudo num baralho para revisar na aba Flashcards |
| **Plano de estudo** | Plano da semana. Um toque transforma o plano em **tarefas** |
| **Pergunta livre** | Converse sobre a anotação ("o que é denominador?") |

O resultado pode ser **escrito na folha**, alinhado às pautas, **ouvido em voz alta**, copiado ou enviado. Pelo menu **⋮** de uma anotação ou de uma pasta, dá para resumir uma **pasta inteira** e salvar como anotação nova. A mesma IA faz o **Tutor**, o **Simulado**, o resumo das **gravações de aula**, a análise do **Relatório** e o resumo do **Diário**.

### Já vem ligada

A chave do Gemini pode vir **dentro do app** (arquivo `js/chave.js`): assim a IA funciona sem configurar nada. Se um dia ela parar (por exemplo, se o Google desativar a chave), crie outra e cole em **Ajustes e IA**: a chave colada tem prioridade sobre a embutida.

### Usar outra chave (opcional)

1. Entre em **aistudio.google.com/apikey** com a sua conta Google.
2. Toque em **Create API key** (Criar chave de API) e copie a chave.
3. No app, abra **Ajustes e IA**, cole a chave em **Inteligência artificial — Gemini** e toque em **Testar**. Tem que aparecer "✓ Gemini funcionando em 0,8 s".

O app usa o **`gemini-flash-lite-latest`**, que sempre aponta para a versão mais nova e rápida do Flash-Lite, com o raciocínio no nível baixo para responder logo. Para nunca ficar esperando:
- se o principal **não começar a responder em 6 segundos** (o Google às vezes tem picos de demora), o reserva **`gemini-3.1-flash-lite`** entra junto e vale o que responder primeiro;
- se o principal estiver sobrecarregado, o app tenta de novo sozinho e, se continuar, passa para o reserva;
- se a cota gratuita do principal acabar, o reserva (que tem cota separada) responde no lugar.

Medido de verdade em 20/11/2026: texto em **0,8 s**, página do caderno lida em **2,3 s**, simulado de 5 perguntas em **2,1 s**, foto de exercício resolvida pelo tutor em **1,8 s** e resumo de uma aula gravada em **2,6 s**.

## ✨ O que ele faz

| Recurso | Como usar |
|---|---|
| ✍️ **Caneta** (sensível à pressão), **Lápis** (com textura de grafite) e **Marca-texto** | Escolha na barra. Cada ferramenta lembra a **cor** e o **tamanho** dela. Há 10 cores prontas e uma cor livre |
| 🧽 **Borracha** | Pode apagar só o pedaço onde passa ("Parcial") ou o traço todo. O botão da caneta também funciona como borracha |
| ➰ **Laço** | Circule algo para mover, aumentar ou diminuir (bolinha no canto), mudar a cor, duplicar ou apagar |
| ✨ **Corrigir escrita** | Circule a escrita e toque em *Corrigir escrita*. Letras e números feitos à mão viram texto digitado, e aparecem sugestões para você escolher |
| 🧮 **Verificar conta** | Escreva `12 + 8 = 20`, circule e toque em *Verificar conta*. Aparece ✓ se estiver certa, ou ✗ com o resultado correto. Se você não escrever o resultado (`7 × 6 =`), ele mostra o resultado em azul |
| ⚡ **Auto** | Corrige sozinho quando você para de escrever: transforma a escrita em texto ou confere as contas |
| 🔷 **Formas perfeitas** | Desenhe um círculo, retângulo, triângulo ou linha e **segure a caneta parada** por meio segundo |
| 🅣 **Texto** e 🖼️ **Imagem** | Digite textos ou coloque fotos (do livro, da lousa…) na folha |
| 📄 **Páginas e papel** | Pautado, quadriculado, **matemática** (quadriculado fino), pontilhado, **Cornell** (palavras-chave, anotações e resumo) ou liso, em 4 cores |
| 📑 **Visão geral das páginas** | Toque no número da página para ver todas em miniatura, pular para uma página, reordenar, duplicar e excluir |
| 📥 **Importar PDF e fotos** | Traga listas de exercícios, apostilas e provas (até 60 páginas por PDF) para escrever por cima. A página importada fica travada no fundo |
| 📁 **Pastas** | Separe por matéria, com cor. Também tem busca, favoritas e ordenação |
| ✅ **Tarefas** | Lista com prazo, prioridade, pasta e ligação com a anotação. Filtros: pendentes, hoje, atrasadas e concluídas |
| 📤 **Compartilhar** | Envia **PDF** (todas as páginas ou só uma) ou **imagem PNG** pelo WhatsApp, Gmail, Drive, Classroom… Dá para enviar uma pasta inteira em PDF e a lista de tarefas como texto |
| 🎙️ **Gravar a aula** | O 🎙️ no topo do editor grava o áudio ligado à anotação; o ▶ ao lado lista as gravações para ouvir, resumir, transcrever ou tirar as tarefas |
| 💾 **Dados e backup** | Tudo é salvo sozinho no banco de dados do tablet. Na tela *Dados e backup* você vê o que está salvo, faz cópias e exporta/restaura um arquivo |

**Gestos:** pinça com 2 dedos = zoom · arrastar com 2 dedos = mover a folha · tocar com 2 dedos = desfazer · tocar com 3 dedos = refazer.

**Palma da mão:** quando o app detecta a caneta, o dedo passa a só mover e dar zoom. Assim a mão apoiada na tela não risca. Isso pode ser mudado em *Ajustes*.

## ⚠️ Bom saber

- **Onde ficam os dados:** tudo é gravado na hora no **banco de dados do próprio app** (IndexedDB do Chrome), mesmo sem internet: anotações, tarefas, flashcards, notas rápidas, conversas, gravações… Em **Dados e backup**, toque em **Proteger meus dados** para o Android não apagar nada quando faltar espaço (instalar o app na tela inicial ajuda).
- **Cópias automáticas:** uma por dia, guardadas dentro do app (as 3 mais recentes). Servem para **voltar no tempo** se algo der errado. Elas não levam o áudio das gravações, que continua salvo.
- **Backup em arquivo:** de vez em quando, toque em **Exportar backup** e guarde o arquivo no Google Drive. Ele leva tudo, até as gravações. **A chave da IA não vai no backup**, por segurança. Não limpe os dados do Chrome sem ter um backup.
- **IA:** precisa de internet. A chave do Gemini está embutida no código, que é público: qualquer pessoa que olhar o código pode usá-la e gastar a cota grátis, e o Google pode desativar chaves publicadas. Se isso acontecer, crie outra e cole em Ajustes e IA. No plano gratuito há limite de pedidos por minuto e por dia, e o Google pode usar o que for enviado para melhorar os produtos dele. Não use a sua chave no tablet de outra pessoa e, se ela vazar, apague-a em aistudio.google.com/apikey e crie outra.
- **Gravações:** ocupam cerca de **10 MB por hora** de aula. A IA consegue resumir de uma vez gravações de até cerca de 1 hora.
- **Correção de escrita e verificação de contas precisam de internet.** Elas usam o reconhecimento de escrita à mão do Google (o mesmo do teclado de escrita do Google), que não é uma API oficial. Se um dia parar, o resto do app continua funcionando. Todo o resto funciona offline.
- As contas aceitam `+ − × ÷ : x / ^ √ %`, parênteses e vírgula decimal (`2,5`).

## 🧪 Testes

`tests/teste-completo.cjs` abre o app num navegador de verdade e passa por **96 cenários**: editor e ferramentas, correção, IA (Gemini simulado, com sobrecarga, modelo reserva e limite), PDF, tarefas, foco, flashcards, hábitos, leitura, notas, relatório e mapa do ano, busca por dentro do texto, menu retrátil (inclusive arrastar da borda), notas rápidas, tutor com foto, gravador com microfone simulado, "O que fazer agora", banco de dados (contagens, cópias, voltar no tempo, verificar e reparar, backup com áudio sem a chave, restaurar em outro tablet, tudo continua depois de reabrir), modo offline, tema escuro e o layout com o tablet em pé e deitado.

```
npm install
npx playwright install chromium
npm test
```

Teste **real** com o Gemini (22 verificações: velocidade, modelo reserva, leitura da página, simulado em JSON, tutor com foto e, se o `espeak-ng` estiver instalado, uma aula falada gravada pelo microfone simulado e resumida, transcrita e transformada em tarefas). A chave vai só pela variável de ambiente e não fica salva em arquivo nenhum:

```
GEMINI_API_KEY=sua_chave node tests/teste-gemini-real.cjs
```

## 🛠️ Para desenvolvedores

É HTML, CSS e JavaScript puro, sem etapa de build. A única biblioteca usada (pdf.js) fica embutida em `js/vendor/`.

```
index.html            estrutura das telas
css/style.css         visual (tema claro/escuro, menu retrátil, telas em pé e deitado)
js/app.js             liga tudo: biblioteca, pastas, tarefas, ajustes, compartilhar
js/editor.js          editor: ferramentas, gestos, laço, desfazer, páginas, correção
js/ink.js             desenho dos traços, papel, texto, imagens e geometria
js/shapes.js          reconhecimento de formas
js/recognize.js       reconhecimento de escrita + verificador de contas
js/export.js          gerador de PDF/PNG e compartilhamento
js/ai.js              IA pelo Gemini rapidão: pedidos em streaming, modelo reserva e erros
js/aipanel.js         painel da IA no editor e janela de IA para pastas/anotações
js/importer.js        importação de PDF (pdf.js) e fotos como páginas
js/hub.js             Hoje, Foco (Pomodoro), Agenda, Flashcards (repetição espaçada) e Hábitos
js/perf.js            Leitura/Kindle, Notas e provas, Relatório, mapa do ano, Conquistas, Atalhos e Busca
js/plus.js            Horário de aulas, Diário, Revisão espaçada, Quadro e Matriz de tarefas
js/goals.js           Metas com progresso automático
js/quiz.js            Simulado com IA (perguntas em JSON, correção e histórico)
js/quicknotes.js      Notas rápidas (post-its, listas de marcar)
js/tutor.js           Tutor IA (conversa, foto do exercício, voz)
js/recorder.js        Gravador de aula e resumo/transcrição do áudio pela IA
js/suggest.js         "O que fazer agora" no painel Hoje
js/voice.js           ler em voz alta e ditado
js/data.js            Dados e backup: contagens, cópias automáticas, exportar/importar, reparar
js/nav.js             navegação: menu em 3 áreas (retrátil), barra de baixo, botão +, tela Tudo, dicas e tour
js/sound.js           sons de foco (ruídos gerados no tablet)
js/store.js           banco de dados local (IndexedDB) e configurações
js/flow.js            escrita organizada (texto nas pautas, parágrafos e continuação na página seguinte)
js/events.js          eventos da agenda, prioridade e avisos
js/chave.js           lugar da chave do Gemini embutida (opcional)
fonts/                fontes manuscritas (SIL Open Font License, ver fonts/LICENSE-OFL.txt)
js/vendor/            pdf.js 6.5.438, embutido
sw.js                 funcionamento offline
tests/                teste completo automatizado e teste real do Gemini
```

Para testar no computador: `python3 -m http.server 8000` e abra `http://localhost:8000`.
