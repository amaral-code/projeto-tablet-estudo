# 📒 Caderno de Estudos

Caderno digital para estudar no **REDMI Pad 2** com a Redmi Smart Pen (ou com o dedo), no estilo do Mi Canvas. Ele também **corrige letras e números escritos à mão** e **confere contas**.

Funciona como aplicativo instalado (PWA): abre em tela cheia, funciona **sem internet** e guarda tudo no próprio tablet.

## ✦ Assistente de IA (novo)

Toque no botão roxo **IA** dentro de uma anotação. A IA (Claude, da Anthropic) **lê a sua letra direto da folha**, sem precisar converter antes. Escolha **Seleção**, **Esta página** ou **Todas** e peça:

| Ação | O que faz |
|---|---|
| **Resumir** | Resumo de estudo com ideias principais, conceitos e "Para lembrar" |
| **Melhorar a escrita** | Reescreve corrigindo ortografia, acentuação, gramática e clareza, e explica cada correção ("errado → certo") |
| **Escrever mais** | Aprofunda a matéria com explicações, exemplos e detalhes que faltam |
| **Explicar passo a passo** | Explica como um professor e resolve os exercícios mostrando onde você errou |
| **Perguntas de revisão** | 10 perguntas, da mais fácil para a mais difícil, com gabarito |
| **Flashcards** | Pares de pergunta e resposta para memorizar |
| **Plano de estudo** | Plano da semana. Um toque transforma o plano em **tarefas** |
| **Pergunta livre** | Converse sobre a anotação ("o que é denominador?") |

O resultado pode ser **escrito na folha**, alinhado às pautas (numa página nova ou abaixo do que já está escrito), além de copiado ou enviado. Pelo menu **⋮** de uma anotação ou de uma pasta, dá para resumir uma **pasta inteira** e salvar o resultado como uma anotação nova.

**Como ativar:** crie uma chave em **platform.claude.com → API Keys**, depois cole em **Ajustes → Inteligência artificial** e toque em **Testar**. Você pode escolher o modelo: Opus 5.5 (melhor qualidade, padrão), Sonnet 5.5 ou Haiku 5.5 (o mais barato).

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
| 💾 **Backup** | Em *Ajustes* você exporta e restaura tudo num arquivo |

**Gestos:** pinça com 2 dedos = zoom · arrastar com 2 dedos = mover a folha · tocar com 2 dedos = desfazer · tocar com 3 dedos = refazer.

**Palma da mão:** quando o app detecta a caneta, o dedo passa a só mover e dar zoom. Assim a mão apoiada na tela não risca. Isso pode ser mudado em *Ajustes*.

## 📲 Como instalar no REDMI Pad 2

O app precisa estar num endereço `https://`. O jeito mais fácil e gratuito é o **GitHub Pages**:

1. No GitHub, junte este branch ao `main` (crie um Pull Request e faça o merge).
2. Vá em **Settings → Pages**.
3. Em *Build and deployment*, escolha **Source: Deploy from a branch**, depois **Branch: `main`** e a pasta **`/ (root)`**. Clique em **Save**.
4. Espere 1 ou 2 minutos. O endereço será algo como `https://SEU-USUARIO.github.io/projeto-tablet-estudo/`.
5. No tablet, abra esse endereço no **Google Chrome**.
6. Toque em **⋮ → Adicionar à tela inicial → Instalar**.

Pronto: o ícone **Caderno** aparece na tela inicial e abre em tela cheia, como um app normal.

> Dica: na primeira vez, abra o app com internet para ele ficar guardado e funcionar offline depois.

## ⚠️ Bom saber

- **A IA precisa de internet e de uma chave da Anthropic.** O uso é cobrado na sua conta da Anthropic, por tamanho de pedido e resposta. Enviar muitas páginas de uma vez custa mais. A chave fica salva só neste tablet e é enviada apenas para a Anthropic. Não use a sua chave num tablet de outra pessoa.
- **Correção de escrita e verificação de contas precisam de internet.** Elas usam o reconhecimento de escrita à mão do Google (o mesmo serviço do teclado de escrita do Google). Todo o resto funciona offline.
- O serviço de reconhecimento não é uma API oficial e documentada. Se um dia ele parar de responder, o resto do app continua funcionando normalmente.
- As anotações ficam **só no tablet**, no armazenamento do navegador. Não limpe os dados do Chrome. Faça **backup** de vez em quando em *Ajustes → Exportar backup* e salve o arquivo no Drive.
- As contas aceitam `+ − × ÷ : x / ^ √ %`, parênteses e vírgula decimal (`2,5`).

## 🛠️ Para desenvolvedores

É HTML, CSS e JavaScript puro, sem etapa de build. As duas bibliotecas usadas ficam embutidas em `js/vendor/`.

```
index.html            estrutura das telas
css/style.css         visual (tema claro/escuro automático)
js/app.js             biblioteca, pastas, tarefas, ajustes, backup, compartilhar
js/editor.js          editor: ferramentas, gestos, laço, desfazer, páginas, correção
js/ink.js             desenho dos traços, papel, texto, imagens e geometria
js/shapes.js          reconhecimento de formas
js/recognize.js       reconhecimento de escrita + verificador de contas
js/export.js          gerador de PDF/PNG e compartilhamento
js/ai.js              assistente de IA (Claude): pedidos, ações e tratamento de erros
js/aipanel.js         painel da IA no editor e janela de IA para pastas/anotações
js/importer.js        importação de PDF (pdf.js) e fotos como páginas
js/vendor/            SDK oficial da Anthropic (@anthropic-ai/sdk 1.11.0) e pdf.js 6.5.438, embutidos
js/store.js           banco local (IndexedDB) e configurações
sw.js                 funcionamento offline
```

Para testar no computador: `python3 -m http.server 8000` e abra `http://localhost:8000`.
