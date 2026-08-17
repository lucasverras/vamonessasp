#!/usr/bin/env python3
"""
Instagram Login  x  Facebook Login — teste real, agressivo, contra @vamonessasp.

Premissa que este script assume como VERDADEIRA e nunca tenta alterar:
Facebook e Instagram do Vamo Nessa já estão vinculados no mesmo Business
Portfolio, e a Página Vamo Nessa SP já aponta para a conta profissional correta.
O script apenas LÊ. Não cria Página, não altera vínculo, não muda configuração.

A pergunta que ele responde NÃO é "o Instagram tem seguidores por Reel?" — isso
já sabemos que sim, a interface nativa mostra. A pergunta é:

    "Existe ALGUM endpoint, campo, versão ou método oficial da Meta que exponha
     esse dado para a nossa conta?"

Por isso cada métrica contestada é atacada por SEIS caminhos de acesso distintos,
em 5 versões da API, nos 2 hosts. Uma métrica só é dada como não exposta depois
de falhar em todos.

Uso:
    set -a; . ./.env.local; set +a
    python3 scripts/compare-logins.py

Saída bruta e auditável: scripts/out/compare-logins.json
"""
import json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

IG_TOKEN = os.environ.get("META_DEV_ACCESS_TOKEN")
FB_TOKEN = os.environ.get("META_DEV_FB_USER_TOKEN")

VERSIONS = ["v22.0", "v23.0", "v24.0", "v25.0", "v26.0"]
CURRENT = "v26.0"

# Métricas que funcionam e servem de controle — se estas falharem no login B,
# o problema é de token/permissão, não da métrica.
BASELINE = ["views", "reach", "likes", "comments", "shares", "saved",
            "total_interactions", "ig_reels_avg_watch_time",
            "ig_reels_video_view_total_time", "reels_skip_rate"]

# Métricas contestadas — atacadas por todos os caminhos, em todas as versões.
CONTESTED = ["follows", "profile_activity", "profile_visits", "reposts"]

# Campos diretos do objeto Media (não são insights).
CONTESTED_FIELDS = ["reposts_count", "total_views_count", "total_like_count",
                    "total_comments_count", "saved_count", "shares_count",
                    "view_count", "like_count", "comments_count"]

LOG: list[dict] = []
CALLS = 0


def request(host, version, path, params, token):
    global CALLS
    CALLS += 1
    p = dict(params); p["access_token"] = token
    url = f"https://{host}/{version}/{path}?{urllib.parse.urlencode(p)}"
    safe = f"https://{host}/{version}/{path}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return {"status": r.status, "body": json.loads(r.read().decode()), "url": safe}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            body = json.loads(raw)
        except Exception:
            body = {"_unparsed": raw[:400]}
        return {"status": e.code, "body": body, "url": safe}
    except Exception as e:
        return {"status": None, "body": {"_transport_error": str(e)}, "url": safe}


def extract(body):
    """Tenta achar um valor útil em qualquer formato de resposta."""
    if not isinstance(body, dict) or "error" in body:
        return None
    if "data" in body and isinstance(body["data"], list) and body["data"]:
        d0 = body["data"][0]
        if isinstance(d0, dict):
            if "values" in d0 and d0["values"]:
                return d0["values"][0].get("value")
            if "total_value" in d0:
                return d0["total_value"].get("value")
        return body["data"]
    for k, v in body.items():
        if k not in ("id",):
            return v
    return body.get("id")


def record(metric, caminho, login, host, version, endpoint, media_id, res,
           require_key=None):
    err = res["body"].get("error") if isinstance(res["body"], dict) else None
    ok = err is None and "_transport_error" not in (res["body"] or {})
    # campo pedido pode voltar OMITIDO com HTTP 200 — isso NÃO é sucesso
    if ok and require_key is not None:
        ok = require_key in (res["body"] if isinstance(res["body"], dict) else {})
    val = extract(res["body"]) if ok else None
    LOG.append({
        "metrica": metric, "caminho_de_acesso": caminho, "login": login,
        "host": host, "graph_api_version": version, "endpoint": endpoint,
        "media_id": media_id, "http_status": res["status"],
        "resposta_raw": res["body"], "resultado": "OK" if ok else "ERRO",
        "valor": val, "erro_code": (err or {}).get("code"),
        "erro_subcode": (err or {}).get("error_subcode"),
        "erro_mensagem": (err or {}).get("message"),
    })
    return ok, val, (err or {}).get("message", "")


# ---- os SEIS caminhos de acesso tentados para cada métrica contestada --------
def attack(metric, host, version, media_id, token, login):
    """Retorna (exposta_em_algum_caminho, [(caminho, ok, valor, erro)])."""
    paths = [
        ("insights simples",
         f"{media_id}/insights", {"metric": metric}),
        ("insights + metric_type=total_value",
         f"{media_id}/insights", {"metric": metric, "metric_type": "total_value"}),
        ("insights + period=lifetime",
         f"{media_id}/insights", {"metric": metric, "period": "lifetime"}),
        ("insights + breakdown=action_type",
         f"{media_id}/insights", {"metric": metric, "metric_type": "total_value",
                                  "breakdown": "action_type"}),
        ("campo direto do Media",
         f"{media_id}", {"fields": metric}),
        ("field expansion insights.metric()",
         f"{media_id}", {"fields": f"insights.metric({metric})"}),
    ]
    out, exposed = [], False
    for caminho, path, params in paths:
        res = request(host, version, path, params, token)
        ok, val, msg = record(metric, caminho, login, host, version,
                              "/" + path.split("/", 1)[-1] if "/" in path else "/{media-id}",
                              media_id, res)

        # ARMADILHA REAL, observada em 17/08/2026: para `fields=`, a Meta responde
        # HTTP 200 com apenas {"id": "..."} e OMITE o campo pedido, sem erro
        # algum. Aceitar isso como sucesso produz falso positivo. Portanto, aqui
        # só conta como exposta quando a chave pedida VOLTA NA RESPOSTA com dado.
        body = res["body"] if isinstance(res["body"], dict) else {}
        if ok and caminho == "field expansion insights.metric()":
            ins = body.get("insights")
            ok = bool(ins and ins.get("data"))
            val = ins.get("data") if ok else None
            if not ok:
                msg = "HTTP 200 mas a resposta não contém 'insights' — campo omitido"
        elif ok and caminho == "campo direto do Media":
            ok = metric in body
            val = body.get(metric) if ok else None
            if not ok:
                msg = f"HTTP 200 mas a resposta não contém '{metric}' — campo omitido"
        elif ok:
            ok = bool(body.get("data"))
            if not ok:
                msg = "HTTP 200 sem 'data'"

        LOG[-1]["resultado"] = "OK" if ok else "ERRO"
        LOG[-1]["valor"] = val
        LOG[-1]["observacao"] = None if ok else msg

        out.append((caminho, ok, val, msg))
        exposed = exposed or ok
    return exposed, out


def hr(t):
    print("\n" + "=" * 98); print(t); print("=" * 98)


# ============================================================ LOGIN A
hr("LOGIN A — Instagram API with Instagram Login   (graph.instagram.com)")
if not IG_TOKEN:
    sys.exit("META_DEV_ACCESS_TOKEN ausente no .env.local")

me = request("graph.instagram.com", CURRENT, "me",
             {"fields": "user_id,username,media_count"}, IG_TOKEN)
if me["body"].get("error"):
    sys.exit(f"token do Instagram inválido: {me['body']['error'].get('message')}")
IG_USER_ID = str(me["body"]["user_id"])
print(f"  conta @{me['body'].get('username')}  ig_user_id={IG_USER_ID}  "
      f"{me['body'].get('media_count')} mídias")

med = request("graph.instagram.com", CURRENT, "me/media",
              {"fields": "id,media_product_type,timestamp,permalink", "limit": 100},
              IG_TOKEN)["body"].get("data", [])
reels = sorted([m for m in med if m.get("media_product_type") == "REELS"],
               key=lambda m: m["timestamp"], reverse=True)
feed = [m for m in med if m.get("media_product_type") == "FEED"]
SAMPLES = [("REELS_1", reels[0]), ("REELS_2", reels[1]), ("REELS_3", reels[2])]
if feed:
    SAMPLES.append(("FEED", feed[0]))
print("  mídias sob teste (as MESMAS serão usadas no login B):")
for lbl, m in SAMPLES:
    print(f"    {lbl:9} {m['id']}  {m['timestamp'][:10]}  {m['permalink']}")

print("\n  baseline (controle) no REELS mais recente:")
base_a = {}
for metric in BASELINE:
    res = request("graph.instagram.com", CURRENT, f"{SAMPLES[0][1]['id']}/insights",
                  {"metric": metric}, IG_TOKEN)
    ok, val, msg = record(metric, "insights simples", "Instagram Login",
                          "graph.instagram.com", CURRENT, "/{media-id}/insights",
                          SAMPLES[0][1]["id"], res)
    base_a[metric] = ok
    print(f"    {'✓' if ok else '✗'} {metric:32} {val if ok else msg[:56]}")

print("\n  ATAQUE às métricas contestadas — 6 caminhos x 5 versões x cada mídia:")
exposed_a = {m: False for m in CONTESTED}
detail_a = {}
for metric in CONTESTED:
    print(f"\n    ### {metric}")
    for lbl, m in SAMPLES:
        hits = []
        for v in VERSIONS:
            ex, out = attack(metric, "graph.instagram.com", v, m["id"], IG_TOKEN,
                             "Instagram Login")
            if ex:
                hits += [f"{v}:{c}" for c, ok, _, _ in out if ok]
            if v == CURRENT:
                detail_a[(metric, lbl)] = out
        if hits:
            exposed_a[metric] = True
            print(f"      ✓ {lbl:9} EXPOSTA em {len(hits)} caminho(s): {hits[:3]}")
        else:
            print(f"      ✗ {lbl:9} nenhum dos 30 caminhos expôs")

print("\n  campos diretos do objeto Media x versões:")
fields_a = {}
for f in CONTESTED_FIELDS:
    hits = [v for v in VERSIONS
            if record(f, "campo direto do Media", "Instagram Login", "graph.instagram.com", v,
                      "/{media-id}?fields=", SAMPLES[0][1]["id"],
                      request("graph.instagram.com", v, SAMPLES[0][1]["id"],
                              {"fields": f}, IG_TOKEN), require_key=f)[0]]
    fields_a[f] = bool(hits)
    print(f"    {'✓' if hits else '✗'} {f:24} {('em ' + ','.join(hits)) if hits else ''}")


# ============================================================ LOGIN B
hr("LOGIN B — Instagram API with Facebook Login   (graph.facebook.com)")
exposed_b = {m: False for m in CONTESTED}
fields_b = {}
base_b = {}
FB_READY = False

if not FB_TOKEN:
    print("""
  META_DEV_FB_USER_TOKEN ausente — login B não executado.

  Os vínculos JÁ EXISTEM (Página ↔ Instagram no mesmo Business Portfolio).
  O único passo faltante é emitir um token de usuário do Facebook:

    1. developers.facebook.com/tools/explorer
    2. Meta App: VamoNessaSP        3. "Get User Access Token"
    4. permissões: instagram_basic, instagram_manage_insights,
       instagram_manage_comments, instagram_manage_messages, pages_show_list,
       pages_read_engagement, pages_manage_metadata, pages_messaging
    5. Generate Access Token → autorize → cole em META_DEV_FB_USER_TOKEN
""")
else:
    acc = request("graph.facebook.com", CURRENT, "me/accounts",
                  {"fields": "id,name,access_token,instagram_business_account{id,username}"},
                  FB_TOKEN)
    if acc["body"].get("error"):
        print(f"  ✗ token do Facebook rejeitado: {acc['body']['error'].get('message')}")
    else:
        pages = acc["body"].get("data", [])
        print(f"  Páginas visíveis: {len(pages)}")
        page = None
        for p in pages:
            iba = p.get("instagram_business_account") or {}
            alvo = str(iba.get("id")) == IG_USER_ID
            print(f"    {'►' if alvo else ' '} {p.get('name'):32} page_id={p.get('id'):18} "
                  f"IG={iba.get('username') or '—'} {iba.get('id') or ''}")
            # A Página CORRETA é a que aponta para o MESMO ig_user_id do login A.
            # Escolher qualquer outra invalida a comparação (bug real, 17/08/2026:
            # pegar "a última com Instagram" selecionou a conta de outro cliente).
            if alvo:
                page = p
        if not page:
            print(f"\n  ✗ ABORTADO: nenhuma das {len(pages)} Páginas aponta para o")
            print(f"    ig_user_id do login A ({IG_USER_ID} = @vamonessasp).")
            print("    Sem a MESMA conta nos dois lados, a comparação não tem valor.")
        else:
            FB_READY = True
            PAGE_TOKEN, PAGE_ID = page["access_token"], page["id"]
            IGBA = str(page["instagram_business_account"]["id"])
            print(f"\n  Página: {page['name']} ({PAGE_ID})")
            print(f"  IG business account: {IGBA} "
                  f"(@{page['instagram_business_account'].get('username')})")
            print(f"  Confere com o Instagram Login ({IG_USER_ID})? "
                  f"{'SIM — é a mesma conta' if IGBA == IG_USER_ID else 'NÃO — contas diferentes!'}")

            # garante que comparamos O MESMO conteúdo, mesmo se o ID diferir
            fbmed = request("graph.facebook.com", CURRENT, f"{IGBA}/media",
                            {"fields": "id,permalink,timestamp,media_product_type",
                             "limit": 100}, PAGE_TOKEN)["body"].get("data", [])
            by_link = {m.get("permalink"): m["id"] for m in fbmed}
            mapping = {}
            for lbl, m in SAMPLES:
                fb_id = by_link.get(m["permalink"])
                mapping[lbl] = fb_id or m["id"]
                same = "mesmo id" if fb_id == m["id"] else (
                    f"id difere → {fb_id}" if fb_id else "não encontrada por permalink; usando id do IG Login")
                print(f"    {lbl:9} {same}")

            print("\n  baseline (controle):")
            for metric in BASELINE:
                res = request("graph.facebook.com", CURRENT, f"{mapping['REELS_1']}/insights",
                              {"metric": metric}, PAGE_TOKEN)
                ok, val, msg = record(metric, "insights simples", "Facebook Login",
                                      "graph.facebook.com", CURRENT, "/{media-id}/insights",
                                      mapping["REELS_1"], res)
                base_b[metric] = ok
                print(f"    {'✓' if ok else '✗'} {metric:32} {val if ok else msg[:56]}")

            print("\n  ATAQUE às métricas contestadas — 6 caminhos x 5 versões x cada mídia:")
            for metric in CONTESTED:
                print(f"\n    ### {metric}")
                for lbl in mapping:
                    hits = []
                    for v in VERSIONS:
                        ex, out = attack(metric, "graph.facebook.com", v, mapping[lbl],
                                         PAGE_TOKEN, "Facebook Login")
                        if ex:
                            hits += [f"{v}:{c}" for c, ok, _, _ in out if ok]
                    if hits:
                        exposed_b[metric] = True
                        print(f"      ✓ {lbl:9} EXPOSTA em {len(hits)} caminho(s): {hits[:3]}")
                    else:
                        print(f"      ✗ {lbl:9} nenhum dos 30 caminhos expôs")

            print("\n  campos diretos do objeto Media x versões:")
            for f in CONTESTED_FIELDS:
                hits = [v for v in VERSIONS
                        if record(f, "campo direto do Media", "Facebook Login",
                                  "graph.facebook.com", v, "/{media-id}?fields=",
                                  mapping["REELS_1"],
                                  request("graph.facebook.com", v, mapping["REELS_1"],
                                          {"fields": f}, PAGE_TOKEN), require_key=f)[0]]
                fields_b[f] = bool(hits)
                print(f"    {'✓' if hits else '✗'} {f:24} {('em ' + ','.join(hits)) if hits else ''}")

            # ---------------- permissões realmente concedidas ----------------
            print("\n  PERMISSÕES concedidas ao token do Facebook:")
            perms = request("graph.facebook.com", CURRENT, "me/permissions", {}, FB_TOKEN)
            record("permissions", "capacidade", "Facebook Login", "graph.facebook.com",
                   CURRENT, "/me/permissions", "-", perms)
            granted, declined = set(), set()
            for p in perms["body"].get("data", []):
                (granted if p.get("status") == "granted" else declined).add(p["permission"])
            NEEDED = ["instagram_basic", "instagram_manage_insights",
                      "instagram_manage_comments", "instagram_manage_messages",
                      "pages_show_list", "pages_read_engagement",
                      "pages_manage_metadata", "pages_messaging"]
            for p in NEEDED:
                mark = "✓" if p in granted else ("✗ RECUSADA" if p in declined else "✗ ausente")
                print(f"    {mark:11} {p}")
            extra_granted = sorted(granted - set(NEEDED))
            if extra_granted:
                print(f"    (extras concedidas: {', '.join(extra_granted)})")

            # ---------------- tarefas na Página (MESSAGING é o que libera DM) --
            tasks = request("graph.facebook.com", CURRENT, "me/accounts",
                            {"fields": "id,name,tasks"}, FB_TOKEN)
            record("page_tasks", "capacidade", "Facebook Login", "graph.facebook.com",
                   CURRENT, "/me/accounts?fields=tasks", PAGE_ID, tasks)
            for p in tasks["body"].get("data", []):
                if str(p.get("id")) == str(PAGE_ID):
                    t = p.get("tasks", [])
                    print(f"\n  TAREFAS na Página: {', '.join(t) if t else '(nenhuma)'}")
                    print(f"    MESSAGING presente (requisito de Private Reply)? "
                          f"{'SIM' if 'MESSAGING' in t else 'NÃO'}")
                    print(f"    ANALYZE presente (requisito de Insights)? "
                          f"{'SIM' if 'ANALYZE' in t else 'NÃO'}")

            # ---------------- capacidades operacionais -----------------------
            print("\n  CAPACIDADES OPERACIONAIS (não podemos perder ao migrar):")
            checks = [
                ("ler comentários", f"{mapping['REELS_1']}/comments",
                 {"fields": "id,text,timestamp,username,from,parent_id,like_count",
                  "limit": 5}, PAGE_TOKEN),
                ("insights de conta", f"{IGBA}/insights",
                 {"metric": "reach", "period": "day", "metric_type": "total_value"}, PAGE_TOKEN),
                ("follower_count histórico", f"{IGBA}/insights",
                 {"metric": "follower_count", "period": "day"}, PAGE_TOKEN),
                ("follows_and_unfollows", f"{IGBA}/insights",
                 {"metric": "follows_and_unfollows", "period": "day",
                  "metric_type": "total_value"}, PAGE_TOKEN),
                ("assinaturas de webhook", f"{PAGE_ID}/subscribed_apps", {}, PAGE_TOKEN),
                ("conversations (messaging)", f"{PAGE_ID}/conversations",
                 {"platform": "instagram", "limit": 1}, PAGE_TOKEN),
                ("perfil IG pela Página", f"{IGBA}",
                 {"fields": "id,username,followers_count,media_count,profile_picture_url"},
                 PAGE_TOKEN),
            ]
            for nome, path, params, tok in checks:
                res = request("graph.facebook.com", CURRENT, path, params, tok)
                ok = "error" not in res["body"]
                record(nome, "capacidade", "Facebook Login", "graph.facebook.com",
                       CURRENT, "/" + path, PAGE_ID, res)
                extra = ""
                if ok and nome == "ler comentários":
                    ds = res["body"].get("data", [])
                    has_from = bool(ds and ds[0].get("from"))
                    fromk = sorted(ds[0].get("from", {}).keys()) if has_from else []
                    extra = f"{len(ds)} lidos · from presente: {has_from} {fromk}"
                elif ok and nome == "perfil IG pela Página":
                    b = res["body"]
                    extra = f"@{b.get('username')} · {b.get('followers_count')} seguidores"
                elif ok:
                    extra = json.dumps(res["body"].get("data", res["body"]),
                                       ensure_ascii=False)[:70]
                print(f"    {'✓' if ok else '✗'} {nome:26} "
                      f"{extra or (res['body'].get('error',{}).get('message','')[:52])}")

            # Private Reply: NÃO enviamos mensagem real — isso escreveria para uma
            # pessoa de verdade. Verificamos os pré-requisitos oficiais.
            print("\n  PRIVATE REPLY — pré-requisitos (nenhuma mensagem foi enviada):")
            pr = [("permissão instagram_manage_comments", "instagram_manage_comments" in granted),
                  ("permissão instagram_manage_messages", "instagram_manage_messages" in granted),
                  ("permissão pages_messaging", "pages_messaging" in granted),
                  ("Page Access Token obtido", bool(PAGE_TOKEN)),
                  ("endpoint /{page-id}/messages alcançável",
                   request("graph.facebook.com", CURRENT, f"{PAGE_ID}/messages",
                           {}, PAGE_TOKEN)["status"] in (400, 403))]
            for nome, ok in pr:
                print(f"    {'✓' if ok else '✗'} {nome}")


# ================================================================== RESUMO
hr("RESUMO")
print(f"  {'métrica':34} {'IG Login':>12} {'FB Login':>14}")
print("  " + "-" * 62)
for m in BASELINE:
    b = ("✓" if base_b.get(m) else "✗") if FB_READY else "não testado"
    print(f"  {m:34} {('✓' if base_a.get(m) else '✗'):>12} {b:>14}")
print("  " + "-" * 62)
for m in CONTESTED:
    b = ("✓ EXPOSTA" if exposed_b[m] else "✗") if FB_READY else "não testado"
    print(f"  {m:34} {('✓ EXPOSTA' if exposed_a[m] else '✗'):>12} {b:>14}")
print("  " + "-" * 62)
for f in CONTESTED_FIELDS:
    b = ("✓" if fields_b.get(f) else "✗") if FB_READY else "não testado"
    print(f"  {f + ' (campo)':34} {('✓' if fields_a.get(f) else '✗'):>12} {b:>14}")

out = pathlib.Path(__file__).parent / "out"
out.mkdir(exist_ok=True)
dest = out / "compare-logins.json"
dest.write_text(json.dumps({
    "executado_em": datetime.now(timezone.utc).isoformat(),
    "chamadas": CALLS,
    "ig_user_id": IG_USER_ID,
    "midias": {l: m["id"] for l, m in SAMPLES},
    "facebook_login_executado": FB_READY,
    "testes": LOG,
}, ensure_ascii=False, indent=2))
print(f"\n  {CALLS} chamadas. Log bruto: {dest}")
print("  Nenhum vínculo, Página ou configuração foi criado ou alterado — só leitura.")
