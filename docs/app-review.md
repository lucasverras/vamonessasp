# App Review — Advanced Access de `instagram_manage_messages`

É a ÚNICA peça que falta para: (1) filtrar seguidores automaticamente
(`is_user_follow_business`), (2) receber respostas de DM (webhook `messages`),
(3) menções em story. Verificado empiricamente em 18/08/2026 — o erro da API
diz literalmente: Advanced Access OU papel no app; não existe terceiro caminho.

O mecanismo do painel já está pronto: aprovado o review, o filtro de seguidor
liga sozinho, sem deploy.

## Passo a passo (leva ~30 min + screencast)

1. **developers.facebook.com → VamoNessaSP → App Review → Permissions and
   Features** → procure `instagram_manage_messages` → **Request Advanced Access**.

2. **Verificação de negócio**: se o Business Manager ainda não estiver
   verificado, a Meta vai pedir (CNPJ ou documento + comprovante). É pré-requisito.

3. **Descrição de uso** — cole/adapte (em inglês):

   > Our app powers an internal moderation panel for our own Instagram
   > professional account (@vamonessasp). When someone comments on our Reels,
   > we reply publicly and — only if the person does NOT already follow us —
   > send a single private reply inviting them to follow. We use
   > `is_user_follow_business` to check the follow status BEFORE sending, so
   > existing followers are never messaged. We also receive message webhooks
   > to show incoming replies to our team, who answer manually via the panel.
   > One private reply per person per 60 days, enforced in our database.
   > The app is used only by our own team on our own account.

4. **Screencast** (grave a tela, 2–4 min, pode ser com narração em inglês
   simples ou legendas):
   - Login no painel (vamonessasp.vercel.app) e tela de Comentários;
   - Um comentário real chegando e a resposta pública;
   - A tela de Aprovações mostrando a DM sugerida com o motivo
     "status de follow indisponível";
   - Configurações → template da DM e a janela de 60 dias;
   - Deixe claro: conta própria, equipe própria, um convite por pessoa.

5. **Plataforma de teste**: informe a URL do painel e um usuário de teste
   (crie um em Configurações se pedirem: papel OPERADOR basta).

6. Enviar. Prazo típico: alguns dias úteis. Se recusarem por detalhe do
   vídeo, ajustar e reenviar — é comum precisar de 2 tentativas.

## O que liga sozinho quando aprovar

| Recurso | Estado hoje | Depois do review |
|---|---|---|
| Filtro de seguidor | manual (botões) | automático via API, cache 24h |
| DM p/ não-seguidor | só marcados por você | automática para todos os não-seguidores |
| Respostas de DM recebidas | invisíveis | entram em Aprovações (seu OK) |
| Menção em story | não chega | webhook `messages` entrega |
