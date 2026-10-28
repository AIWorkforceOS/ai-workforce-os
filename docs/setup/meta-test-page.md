# Página de teste da Meta (carrossel e vídeo)

Objetivo: provar a publicação de **carrossel** e **vídeo (Reels)** numa página que não é de cliente, antes de ligar `CONTENT_CAROUSEL_PUBLISH` e `CONTENT_VIDEO_PUBLISH` na Vercel.

## 1. O que só você pode criar (conta na Meta)
1. **Página do Facebook** nova, com **"TESTE"** no nome (ex.: `Alizo TESTE`). O nome precisa conter `teste`, `test` ou `sandbox` — é a trava do sistema.
2. **Conta do Instagram profissional** nova (ex.: `alizo.teste`), vinculada a essa Página (Instagram → Configurações → Conta → Mudar para conta profissional → Conectar à Página).
3. Você precisa ser **administrador** dessa Página.

## 2. Conectar sem risco
- Conecte a Página de teste numa **unidade própria sem Gestor de Conteúdo ativo** (ex.: uma unidade "Teste Meta"). Se ela ficar numa unidade que tem o agente de conteúdo, o cron diário passa a gerar posts para ela.
- Use o botão **Conectar conta** (login com Facebook) e escolha a Página de teste. Modo de publicação: **sugestão**.
- Se o app da Meta estiver em modo de desenvolvimento, a conta que faz o login precisa ter função no app (administrador/desenvolvedor/testador).

## 3. Rodar o teste (super admin, logado em www.alizoai.com)
No console do navegador (F12 → Console), troque o id da conta e o nome:

```js
fetch('/api/content/test-publish', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ social_account_id: 'ID_DA_CONTA_DE_TESTE', kind: 'carousel', confirm: 'Alizo TESTE' }),
}).then((r) => r.json()).then(console.log)
```
Repita com `kind: 'video'`. A resposta traz cada etapa (desenhar/renderizar, Instagram, Facebook), o tempo e o erro de cada uma.

Garantias da rota: só super admin; só página cujo nome tenha "teste/test/sandbox"; exige digitar o nome exato; conteúdo fixo marcado "TESTE" (sem IA, sem custo); não cria post no banco; **recusa qualquer perfil real**.

## 4. O que conferir
- Carrossel: Instagram mostra os 5 slides em ordem, Facebook mostra um post com as fotos.
- Vídeo: o Reels aparece e toca (vertical, ~18 s, sem áudio); o vídeo aparece na Página.
- Na primeira renderização o servidor baixa o ffmpeg (~29 MB); pode demorar alguns segundos a mais.
- Apague os posts de teste depois.

## 5. Se der certo
Ligue as travas (`CONTENT_CAROUSEL_PUBLISH=on` e/ou `CONTENT_VIDEO_PUBLISH=on`) na Vercel. Atenção: carrossel/vídeo **já aprovados** e com data vencida saem de uma vez; aprove só o que quiser publicar antes de ligar.
