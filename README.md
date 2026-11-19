# 📒 Caderno de Estudos

Caderno digital para estudar no **REDMI Pad 2** com a Redmi Smart Pen (ou com o dedo), no estilo do Mi Canvas. Ele também **corrige letras e números escritos à mão** e **confere contas**.

Funciona como aplicativo instalado (PWA): abre em tela cheia, funciona **sem internet** e guarda tudo no próprio tablet.

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
| 📄 **Páginas e papel** | Pautado, quadriculado, pontilhado ou liso, nas cores branco, creme, verde ou escuro. Dá para ter várias páginas por anotação |
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

- **Correção de escrita e verificação de contas precisam de internet.** Elas usam o reconhecimento de escrita à mão do Google (o mesmo serviço do teclado de escrita do Google). Todo o resto funciona offline.
- O serviço de reconhecimento não é uma API oficial e documentada. Se um dia ele parar de responder, o resto do app continua funcionando normalmente.
- As anotações ficam **só no tablet**, no armazenamento do navegador. Não limpe os dados do Chrome. Faça **backup** de vez em quando em *Ajustes → Exportar backup* e salve o arquivo no Drive.
- As contas aceitam `+ − × ÷ : x / ^ √ %`, parênteses e vírgula decimal (`2,5`).

## 🛠️ Para desenvolvedores

É HTML, CSS e JavaScript puro, sem dependências e sem etapa de build.

```
index.html            estrutura das telas
css/style.css         visual (tema claro/escuro automático)
js/app.js             biblioteca, pastas, tarefas, ajustes, backup, compartilhar
js/editor.js          editor: ferramentas, gestos, laço, desfazer, páginas, correção
js/ink.js             desenho dos traços, papel, texto, imagens e geometria
js/shapes.js          reconhecimento de formas
js/recognize.js       reconhecimento de escrita + verificador de contas
js/export.js          gerador de PDF/PNG e compartilhamento
js/store.js           banco local (IndexedDB) e configurações
sw.js                 funcionamento offline
```

Para testar no computador: `python3 -m http.server 8000` e abra `http://localhost:8000`.
