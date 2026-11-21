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
| 🎙️ **Aulas longas (2 h ou mais)** | O gravador salva a aula **a cada 5 segundos** em pedacinhos: dá para gravar aulas de 1h50 ou mais sem pesar o tablet, e se o app fechar no meio (bateria, Android), **a aula volta inteira** ao abrir. A IA resume e transcreve aulas longas enviando o áudio como arquivo (até ~9 h). Também dá para **usar o gravador do próprio Android** (grava com a tela apagada): nas Gravações da anotação, toque em **Importar do gravador do celular**, ou no gravador do Android toque em **Compartilhar → Caderno** (com o app instalado) e a aula chega numa anotação nova |
| 📷 **Foto → folha** | No caderno, toque em importar (⬆) e escolha uma foto do quadro, do livro ou do slide: **Reescrever o conteúdo na folha** faz a IA ler a foto e escrever o texto, as listas e as contas nas linhas (ou cole a foto como página, ou os dois) |
| 🪟 **Dois apps abertos juntos** | Com a tela dividida ou duas janelas do app, o que você faz numa aparece na outra. Escrevendo na **mesma anotação nas duas**, os traços se juntam (nada se perde, nem ao desfazer) |
| 📚 **Muitas anotações** | Testado com **10.000 anotações**: o Caderno abre na hora (as capas aparecem conforme você rola), a busca acha qualquer uma e anotações enormes (100 páginas cheias) salvam sem travar a escrita. O backup com muitas gravações é montado em partes, sem travar |
| ✨ **Adição rápida** | No topo do **Hoje** e no botão **+**: escreva do seu jeito, como “prova de física sexta 8h”, “lista de mat amanhã !”, “dentista 15/12 às 14h30” ou “entregar resumo dia 10”. Antes de salvar, o app mostra o que entendeu: se é **tarefa ou evento** (prova, trabalho, aula, consulta, aniversário), o **dia** (hoje, amanhã, sexta, dia 10, 15/12, daqui a 3 dias, semana que vem), a **hora**, a **matéria** (inclusive apelidos como “mat”, “port”, “hist”) e a **prioridade** (“!” ou “urgente”). Um toque troca entre tarefa e evento, e o aviso tem **Desfazer**. Funciona sem internet. O campo de **Tarefas** também entende essas palavras, mas o que você escolher nos campos vale mais |
| 👆 **Arrastar tarefas** | Na lista de Tarefas, no Hoje e na Agenda: arraste a tarefa com o dedo **→ para concluir** ou **← para adiar para amanhã**, com **Desfazer**. Rolar a tela continua normal |
| 🤖 **Avisos automáticos** | Em **Planejar → Avisos → Automações**, cada uma liga e desliga com um toque e tem horário: **☀️ resumo da manhã** (o que tem hoje: eventos, tarefas e atrasadas, flashcards, provas chegando), **🔥 não perca a sequência** (à noite, se você ainda não estudou), **🗺️ plano atrasado**, **📒 caderno de erros** (quando juntam 5 ou mais, dia sim, dia não), **📊 resumo da semana** (domingo: tempo de foco, tarefas feitas, flashcards) e **🌙 horário de silêncio** (nada toca de madrugada: o aviso espera o fim do silêncio, e o que não faz mais sentido no dia seguinte não toca). Toda notificação tem o botão **⏰ Adiar 15 min** (no Android e no aviso dentro do app) e mostra o Archie. A lista **Avisos já enviados** mostra o que já tocou |
| 🛡️ **À prova de erros** | Se uma tela tiver um problema, só ela mostra **Tentar de novo** (o resto do app continua e nada se perde). Em **Dados e backup → Diagnóstico** aparecem os últimos problemas, com **Copiar relatório** para enviar e **Limpar**. O app também avisa quando o espaço do tablet está quase cheio |
| ✋ **Feito para o tablet** | Com a caneta encostada (e logo depois de levantar), a **palma da mão** não move a folha nem risca. Botões e caixinhas maiores para o dedo, transição suave entre as telas, vibração curta ao concluir tarefa. Com o **teclado aberto**, as janelas encolhem e nada fica escondido atrás dele. Layout conferido deitado, em pé e com a **tela dividida** do Android: o horário da semana cabe em pé, os cartões não sobram sozinhos numa linha e as listas não vazam dos painéis |
| 🦉 **Archie, o mentor** | A corujinha ao lado do botão +. Ele **vê o app inteiro** (tarefas, agenda, provas, planos, desempenho por matéria, erros, hábitos, foco, anotações) e **age por você**: "crie uma tarefa para sexta", "marca a prova de história dia 10", "monte meu plano para a prova", "faz flashcards de verbos", "procura minhas anotações de frações", "abre o caderno de erros", "começa o foco de matemática". Muda de **expressão** conforme o momento (focado no foco, comemora tarefa concluída, cansado de madrugada…), dá **dicas** no balão e **evolui** com o seu nível: Iniciante → Estudante (nível 3) → Analista (6) → Mentor (10) → Lendário (15). Sem internet, ainda responde o que fazer agora e o resumo da semana. Ele não aparece no caderno (para não atrapalhar a escrita) nem no Tutor |
| 📒 **Caderno de erros** | Tudo o que você erra cai aqui sozinho: questões do simulado (e do ENEM), flashcards errados de novo e contas marcadas com ✗ no caderno. Toque em **Revisar**: acertando 2 vezes seguidas, o erro fica resolvido. **Explicar com IA** mostra por que a certa é a certa e uma dica para não errar de novo |
| 🎯 **Simulado estilo ENEM** | Em **Simulado → Estilo ENEM**: escolha a área (Linguagens, Humanas, Natureza, Matemática) e o assunto. A IA monta questões com texto-base e 5 alternativas (A a E), com **tempo de prova** (3 min por questão; entrega sozinho quando acaba), navegação entre as questões e **gabarito comentado** no fim. Os erros vão para o caderno de erros |
| 📊 **Desempenho por matéria** | No **Relatório**: cada matéria com simulados, notas, flashcards, foco das últimas 2 semanas e erros pendentes, e a situação (Forte, Atenção, Reforçar). A matéria mais fraca aparece no "O que fazer agora" |
| 🗺️ **Plano de estudos** | Em **Planejar → Plano de estudos**: diga a prova, a data, as matérias, os assuntos (ou peça à IA) e quantas sessões por dia. O app distribui tudo até a prova intercalando as matérias, guarda os últimos dias para revisão geral e simulado, cria as tarefas e põe a prova na agenda (com aviso). Atrasou? **Reorganizar** refaz a agenda a partir de hoje |
| 🔍 **Busca na letra à mão** | Com internet, o app lê em segundo plano o que você escreveu à mão. A 🔍 e a busca do Caderno passam a achar palavras escritas à mão |
| 🎧 **Ouvir daqui** | Gravando a aula, cada traço lembra em que momento foi escrito. Depois, selecione o trecho com o laço e toque em **Ouvir daqui**: a gravação toca a partir daquele momento |
| 🎙️ **Ditar no caderno** | Botão **Ditar**: você fala e o texto aparece nas linhas, na letra manuscrita. Diga "ponto" para terminar a frase (vira parágrafo novo), "vírgula", "interrogação"… |
| 🧠 **Mapa mental** | No botão roxo **IA → Mapa mental**: a IA lê a anotação e desenha um mapa mental numa página nova, que dá para mover, apagar e completar à mão |
| 📄 **Modelos de página** | Botão ▦ na barra de páginas: Resumo, Lista de exercícios, Cronograma da semana, Linha do tempo, Mapa mental e Plano cartesiano |
| 🧰 **Ferramentas** | **Tabela periódica** interativa (118 elementos, busca, prótons, nêutrons, camadas e distribuição eletrônica), **gráfico de funções** (até 3 funções, raízes, aproximar e colar numa anotação) e **tradutor** (inglês, espanhol, português). No caderno, selecione um texto e toque em **Traduzir** |
| 🔒 **Cadeado** | Em **Ajustes → Cadeado**: senha de 4 a 6 números para o **Diário** e para as anotações que você trancar (⋮ → Trancar com senha). Volta a trancar quando você sai do app. É proteção de privacidade, não criptografia |
| ☁️ **Backup no Google Drive** | Em **Dados e backup → Google Drive**: o backup vai para a sua conta, com 1 toque por dia (o "O que fazer agora" lembra) e atualização sozinha quando você sai do app. Para ligar, cria-se uma vez um "ID do cliente" gratuito no Google Cloud (o app mostra o passo a passo). Sem isso, "Exportar backup" também manda o arquivo para o Drive pelo compartilhar do Android |
| 🟨 **Post-it e grifo** | No caderno, toque em **Post-it**, escolha a cor (amarelo, rosa, azul, verde, laranja, lilás) e ele é colado na folha, com fita adesiva no alto. **Escreva dentro dele com a caneta** (ou digite com o **T**). Ele cobre o que estava embaixo, e o que você escreve nele fica por cima. Com o **laço**, toque no post-it para mover, aumentar ou apagar: o que está escrito vai junto. Com "Organizar nas linhas" ligado, o que você escreve no post-it continua à mão. Para **grifar o que é importante**, selecione com o laço e toque em **Grifar**: texto digitado ganha a faixa de marca-texto (outro toque tira) e letra à mão ganha um grifo reto. Com o **Marca-texto**, um risco quase reto vira uma faixa reta. As **Notas rápidas** também ganharam cara de post-it |
| 💾 **Nada se perde** | O caderno **salva sozinho** a cada traço (escrevendo sem parar, salva pelo menos a cada 4 segundos) e o botão **Salvo ✓** no topo salva na hora quando você quiser. O título salva enquanto você digita. Se o Android fechar o app no meio da gravação, uma **cópia de emergência** volta ao abrir o app. Nas janelas (tarefa, evento, meta, flashcard…), **tocar fora não apaga** o que você escreveu: o app pergunta se quer salvar, e se o app fechar, o **rascunho volta** quando você abrir a mesma janela. O **Diário** salva sozinho enquanto você escreve, e a nota rápida e as perguntas ao tutor guardam rascunho |
| 🔔 **Avisos e lembretes** | No menu **Planejar → Avisos**: escolha o que avisar e a que horas — **eventos** (na véspera e no dia; com hora, X min antes), **tarefas** do dia, **provas** (3 dias antes e na véspera), **aulas** (minutos antes), **flashcards** vencidos, **hábitos** que faltam e **hora de estudar** (dias e horário). A lista **Próximos avisos** mostra tudo o que vai tocar. Os avisos chegam na hora com o app aberto ou em segundo plano; com o app fechado, o Android acorda o app de tempos em tempos (pode atrasar). Para não perder um evento importante, cada evento tem o botão **Google Agenda** (o alarme do celular toca mesmo com o app fechado), e dá para baixar todos os eventos num arquivo **.ics** |
| 🖼️ **Imagem (busca na internet)** | No editor, toque em **Imagem**, escreva o que quer (“Bhaskara”, “Pedro Álvares Cabral”, “célula animal”, “fórmula de Bhaskara”…) ou fale no 🎙️. Aparecem várias imagens da **Wikipédia** e do **Wikimedia Commons** (livres para estudar); toque na que quiser e ela vai para a folha com o **nome em cima** e o **crédito embaixo** (dá para desligar), já selecionada para mover ou aumentar. A imagem fica salva em **Minhas imagens** e funciona até sem internet |
| ∑ **Fórmulas** | Em **Estudar → Fórmulas**: 68 fórmulas de matemática (áreas, perímetros, volumes, Pitágoras, Bhaskara, PA/PG, porcentagem, juros, média…) e física (velocidade, MUV, Torricelli, força, peso, energia, pressão, calor, ondas, Ohm…). Busque pelo nome ou por uma pergunta (“qual a fórmula da força?”, “área da circunferência”), inclusive falando no 🎙️. Preencha os números e deixe em branco o que quer descobrir: o app **calcula na hora** (descobre qualquer letra da fórmula, não só a da esquerda) |
| ✍️ **Escrita organizada** | No editor, em **Ao escrever → Organizar nas linhas**: escreva em qualquer parte da folha e, ao parar, sua letra vira texto em **fonte manuscrita** nas linhas, emendado no fim da linha. Cada **ponto final** começa um parágrafo novo na linha de baixo. No menu ao lado você escolhe a **letra** — **“Igual à minha letra”** (se você escreve em cursiva sai cursiva, se escreve em letra de forma sai de forma) ou uma das 6 manuscritas (Caveat, Patrick Hand, Indie Flower, Kalam, Shadows Into Light, Dancing Script) ou digitada —, o **tamanho** (de Pequena a Enorme, que ocupa duas linhas) e o **recuo do parágrafo**. O texto sempre senta encostado na linha; a **cor** é a da caneta escolhida em cima. Se a folha encher, o texto continua na página seguinte. Funciona sem internet só para as fontes: o reconhecimento da letra precisa de internet |
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

A IA usa uma fila de 3 modelos rápidos do Gemini: o **principal** (Flash-Lite mais novo); se ele demorar mais de 6 s ou estiver sobrecarregado, o **reserva** (Flash-Lite 3.1) entra junto e vale o que responder primeiro; se os dois estiverem sem cota ou fora do ar, o **último recurso** (Flash) responde. A cota grátis é separada por modelo, então o limite diário fica bem maior. Se a internet do tablet piscar, o pedido tenta de novo sozinho.

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

**Palma da mão:** quando o app detecta a caneta, o dedo passa a só mover e dar zoom. Assim a mão apoiada na tela não risca. E enquanto a caneta está escrevendo (e até ~0,7 s depois), o toque da palma é ignorado: a folha não sai do lugar. Isso pode ser mudado em *Ajustes*.

## ⚠️ Bom saber

- **Onde ficam os dados:** tudo é gravado na hora no **banco de dados do próprio app** (IndexedDB do Chrome), mesmo sem internet: anotações, tarefas, flashcards, notas rápidas, conversas, gravações… Em **Dados e backup**, toque em **Proteger meus dados** para o Android não apagar nada quando faltar espaço (instalar o app na tela inicial ajuda).
- **Cópias automáticas:** uma por dia, guardadas dentro do app (as 3 mais recentes). Servem para **voltar no tempo** se algo der errado. Elas não levam o áudio das gravações, que continua salvo.
- **Backup em arquivo:** de vez em quando, toque em **Exportar backup** e guarde o arquivo no Google Drive. Ele leva tudo, até as gravações. **A chave da IA não vai no backup**, por segurança. Não limpe os dados do Chrome sem ter um backup.
- **IA:** precisa de internet. A chave do Gemini está embutida no código, que é público: qualquer pessoa que olhar o código pode usá-la e gastar a cota grátis, e o Google pode desativar chaves publicadas. Se isso acontecer, crie outra e cole em Ajustes e IA. No plano gratuito há limite de pedidos por minuto e por dia, e o Google pode usar o que for enviado para melhorar os produtos dele. Não use a sua chave no tablet de outra pessoa e, se ela vazar, apague-a em aistudio.google.com/apikey e crie outra.
- **Gravações:** ocupam cerca de **10 MB por hora** de aula. A IA resume e transcreve aulas longas (o áudio vai como arquivo para o Gemini e fica lá por até 2 dias). Para gravar com a tela apagada, use o gravador do Android e importe.
- **Correção de escrita e verificação de contas precisam de internet.** Elas usam o reconhecimento de escrita à mão do Google (o mesmo do teclado de escrita do Google), que não é uma API oficial. Se um dia parar, o resto do app continua funcionando. Todo o resto funciona offline.
- As contas aceitam `+ − × ÷ : x / ^ √ %`, parênteses e vírgula decimal (`2,5`).

## 🧪 Testes

`tests/teste-completo.cjs` abre o app num navegador de verdade e passa por **170 cenários**: aulas longas (pedaços salvos, aula recuperada se o app fechar, 1h50 remontada, envio para a IA), gravador do celular (importar e compartilhar), foto → folha, dois apps abertos juntos, 3.000 anotações, adição rápida (frases como “prova de física sexta 8h”), arrastar tarefas, layout no tablet, avisos automáticos (resumo da manhã, sequência, semana, erros, plano atrasado, horário de silêncio, adiar 15 min no app e com o app fechado, histórico), proteção das telas e diagnóstico, rejeição da palma da mão, Archie (expressões, dicas, ações no app, evolução, sem IA), caderno de erros, simulado ENEM, desempenho por matéria, plano de estudos, busca na letra à mão, mapa mental, modelos, Ouvir daqui, ditado, ferramentas, cadeado, Google Drive, post-it (cor, escrever dentro, camadas, mover junto, escrita organizada), grifo, gravação salva ao sair da tela, salvamento (botão Salvar, salvar escrevendo sem parar, cópia de emergência, rascunhos das janelas, Diário automático), editor e ferramentas, correção, IA (Gemini simulado, com sobrecarga, modelo reserva e limite), PDF, tarefas, foco, flashcards, hábitos, leitura, notas, relatório e mapa do ano, busca por dentro do texto, menu retrátil (inclusive arrastar da borda), notas rápidas, tutor com foto, gravador com microfone simulado, "O que fazer agora", banco de dados (contagens, cópias, voltar no tempo, verificar e reparar, backup com áudio sem a chave, restaurar em outro tablet, tudo continua depois de reabrir), modo offline, tema escuro e o layout com o tablet em pé e deitado.

```
npm install
npx playwright install chromium
npm test
```

Teste **real** com o Gemini (30 verificações: Archie criando tarefa com data e prioridade, ENEM, mapa mental, assuntos do plano, tradutor, explicação de erros, velocidade, os 3 modelos da fila, o app caindo no terceiro quando os dois primeiros estão sem cota, leitura da página, simulado em JSON, tutor com foto e, se o `espeak-ng` estiver instalado, uma aula falada gravada pelo microfone simulado e resumida, transcrita e transformada em tarefas). A chave vai só pela variável de ambiente e não fica salva em arquivo nenhum:

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
js/imagesearch.js     botão Imagem: busca na Wikipédia/Commons, baixa e salva em "Minhas imagens"
js/formulas.js        tabela de fórmulas de matemática e física com calculadora
js/flow.js            escrita organizada (texto nas pautas, parágrafos e continuação na página seguinte)
js/events.js          eventos da agenda, prioridade e botão Google Agenda
js/notify.js          Central de Avisos (tela, permissão, Google Agenda e .ics)
js/avisos-core.js     motor dos avisos (o mesmo no app e no service worker)
js/quickparse.js      entende as frases da adição rápida (dia, hora, matéria, tipo)
js/quickadd.js        campo de adição rápida (Hoje, botão + e Tarefas)
js/swipe.js           arrastar tarefa: → conclui, ← adia
js/chave.js           lugar da chave do Gemini embutida (opcional)
fonts/                fontes manuscritas (SIL Open Font License, ver fonts/LICENSE-OFL.txt)
js/vendor/            pdf.js 6.5.438, embutido
sw.js                 funcionamento offline
tests/                teste completo automatizado e teste real do Gemini
```

Para testar no computador: `python3 -m http.server 8000` e abra `http://localhost:8000`.
