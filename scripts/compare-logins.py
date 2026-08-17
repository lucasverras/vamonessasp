#!/usr/bin/env python3
"""
Compara a disponibilidade de métricas entre os dois logins da Meta, com teste
real contra a conta @vamonessasp — não comparação de documentação.

  A) Instagram API with Instagram Login   host graph.instagram.com
  B) Instagram API with Facebook Login    host graph.facebook.com

Executa contra AS MESMAS mídias, AS MESMAS métricas e AS MESMAS versões, e grava
para cada teste: métrica, login, versão, endpoint, media id, HTTP status,
resposta raw da Meta e resultado.

Uso:
    set -a; . ./.env.local; set +a
    python3 scripts/compare-logins.py

Requer no .env.local:
    META_DEV_ACCESS_TOKEN     token de usuário do Instagram (login A)
    META_DEV_FB_USER_TOKEN    token de usuário do Facebook  (login B) — opcional;
                              sem ele, só o login A é testado.

Saída: scripts/out/compare-logins.json  (bruto, auditável)
"""
import json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

IG_TOKEN = os.environ.get("META_DEV_ACCESS_TOKEN")
FB_TOKEN = os.environ.get("META_DEV_FB_USER_TOKEN")
VERSIONS = ["v26.0"]                     # varredura principal
CONTESTED_VERSIONS = ["v22.0", "v23.0", "v24.0", "v25.0", "v26.0"]

METRICS = [
    "views", "reach", "likes", "comments", "shares", "saved",
    "total_interactions", "follows", "profile_visits", "profile_activity",
    "reposts", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time",
    "reels_skip_rate",
]
CONTESTED = ["follows", "reposts", "profile_visits", "profile_activity"]
MEDIA_FIELDS = ["reposts_count", "saved_count", "shares_count", "view_count",
                "total_views_count", "total_like_count", "total_comments_count"]

LOG: list[dict] = []
CALLS = 0


def request(host: str, version: str, path: str, params: dict) -> dict:
    """Retorna {status, body, url_sem_token}. Nunca registra o token."""
    global CALLS
    CALLS += 1
    qs = urllib.parse.urlencode(params)
    url = f"https://{host}/{version}/{path}?{qs}"
    safe = f"https://{host}/{version}/{path}?" + urllib.parse.urlencode(
        {k: v for k, v in params.items() if k != "access_token"})
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return {"status": r.status, "body": json.loads(r.read().decode()), "url": safe}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            body = json.loads(raw)
        except Exception:
            body = {"_unparsed": raw[:500]}
        return {"status": e.code, "body": body, "url": safe}
    except Exception as e:
        return {"status": None, "body": {"_transport_error": str(e)}, "url": safe}


def record(metric, login, host, version, endpoint, media_id, res) -> tuple[bool, object]:
    body = res["body"]
    err = body.get("error") if isinstance(body, dict) else None
    ok = err is None
    value = None
    if ok and isinstance(body, dict) and body.get("data"):
        try:
            value = body["data"][0]["values"][0]["value"]
        except (KeyError, IndexError, TypeError):
            value = body["data"]
    LOG.append({
        "metrica": metric,
        "login": login,
        "host": host,
        "graph_api_version": version,
        "endpoint": endpoint,
        "media_id": media_id,
        "http_status": res["status"],
        "resposta_raw": body,
        "resultado": ("OK" if ok else "ERRO"),
        "valor": value,
        "erro_code": (err or {}).get("code"),
        "erro_subcode": (err or {}).get("error_subcode"),
        "erro_mensagem": (err or {}).get("message"),
    })
    return ok, value


def hr(t):
    print("\n" + "=" * 96); print(t); print("=" * 96)


# ============================================================ LOGIN A: Instagram
hr("LOGIN A — Instagram API with Instagram Login  (graph.instagram.com)")
if not IG_TOKEN:
    sys.exit("META_DEV_ACCESS_TOKEN ausente.")

me = request("graph.instagram.com", "v26.0", "me",
             {"fields": "user_id,username,media_count", "access_token": IG_TOKEN})
if me["body"].get("error"):
    sys.exit(f"token do Instagram inválido: {me['body']['error'].get('message')}")
IG_USER_ID = me["body"]["user_id"]
print(f"  conta: @{me['body']['user_id'] and me['body'].get('username')}  "
      f"({me['body'].get('media_count')} mídias)")

med = request("graph.instagram.com", "v26.0", "me/media",
              {"fields": "id,media_product_type,timestamp", "limit": 100,
               "access_token": IG_TOKEN})["body"].get("data", [])
reels = sorted([m for m in med if m.get("media_product_type") == "REELS"],
               key=lambda m: m["timestamp"], reverse=True)
feed = [m for m in med if m.get("media_product_type") == "FEED"]

SAMPLES = [("REELS_recente", reels[0]), ("REELS_2", reels[1]), ("REELS_3", reels[2])]
if feed:
    SAMPLES.append(("FEED", feed[0]))
# guarda o mapeamento id -> rótulo para o login B usar EXATAMENTE as mesmas mídias
SAMPLE_IDS = {label: m["id"] for label, m in SAMPLES}
print(f"  mídias sob teste: {json.dumps(SAMPLE_IDS, indent=2)}")

results_a: dict[tuple[str, str], bool] = {}
for label, m in SAMPLES:
    print(f"\n  --- {label} ({m['id']}) ---")
    for metric in METRICS:
        res = request("graph.instagram.com", "v26.0", f"{m['id']}/insights",
                      {"metric": metric, "access_token": IG_TOKEN})
        ok, val = record(metric, "Instagram Login", "graph.instagram.com", "v26.0",
                         "/{media-id}/insights", m["id"], res)
        results_a[(metric, label)] = ok
        print(f"    {'✓' if ok else '✗'} {metric:32} "
              f"{val if ok else (res['body'].get('error', {}).get('message', ''))[:60]}")

print("\n  campos do objeto media:")
for f in MEDIA_FIELDS:
    res = request("graph.instagram.com", "v26.0", SAMPLES[0][1]["id"],
                  {"fields": f, "access_token": IG_TOKEN})
    ok, _ = record(f, "Instagram Login", "graph.instagram.com", "v26.0",
                   "/{media-id}?fields=", SAMPLES[0][1]["id"], res)
    print(f"    {'✓' if ok else '✗'} {f}")


# ============================================================= LOGIN B: Facebook
hr("LOGIN B — Instagram API with Facebook Login  (graph.facebook.com)")
results_b: dict[tuple[str, str], bool] = {}

if not FB_TOKEN:
    print("""
  META_DEV_FB_USER_TOKEN ausente — login B NÃO testado.

  Para obter (a Página já está vinculada ao Instagram profissional):

   1. App Dashboard → Produtos → adicione "Login do Facebook" e, em Instagram,
      "Configuração da API com login do Facebook".
   2. Abra developers.facebook.com/tools/explorer
   3. Selecione o app do Vamo Nessa em "Meta App".
   4. Em "User or Page", escolha "Get User Access Token".
   5. Marque as permissões:
        instagram_basic
        instagram_manage_insights
        instagram_manage_comments
        instagram_manage_messages
        pages_show_list
        pages_read_engagement
        pages_manage_metadata
        pages_messaging
   6. "Generate Access Token", autorize, e copie o token.
   7. Cole em META_DEV_FB_USER_TOKEN no .env.local e rode este script de novo.
""")
else:
    pages = request("graph.facebook.com", "v26.0", "me/accounts",
                    {"fields": "id,name,access_token,instagram_business_account{id,username}",
                     "access_token": FB_TOKEN})
    if pages["body"].get("error"):
        print("  ✗ token do Facebook inválido:", pages["body"]["error"].get("message"))
    else:
        data = pages["body"].get("data", [])
        print(f"  Páginas acessíveis: {len(data)}")
        page = None
        for p in data:
            iba = p.get("instagram_business_account") or {}
            print(f"    - {p.get('name')} (id={p.get('id')})  "
                  f"IG conectado: {iba.get('username') or '(nenhum)'} {iba.get('id') or ''}")
            if iba.get("id"):
                page = p
        if not page:
            print("\n  ✗ Nenhuma Página com conta profissional do Instagram conectada.")
        else:
            PAGE_TOKEN = page["access_token"]
            IGBA = page["instagram_business_account"]["id"]
            print(f"\n  Página escolhida: {page['name']}")
            print(f"  Instagram Business Account: {IGBA} "
                  f"(@{page['instagram_business_account'].get('username')})")
            print(f"  Mesmo ID do Instagram Login? "
                  f"{'SIM' if str(IGBA) == str(IG_USER_ID) else f'NÃO (IG Login={IG_USER_ID})'}")

            for label, mid in SAMPLE_IDS.items():
                print(f"\n  --- {label} ({mid}) — MESMA mídia do login A ---")
                for metric in METRICS:
                    res = request("graph.facebook.com", "v26.0", f"{mid}/insights",
                                  {"metric": metric, "access_token": PAGE_TOKEN})
                    ok, val = record(metric, "Facebook Login", "graph.facebook.com",
                                     "v26.0", "/{media-id}/insights", mid, res)
                    results_b[(metric, label)] = ok
                    print(f"    {'✓' if ok else '✗'} {metric:32} "
                          f"{val if ok else (res['body'].get('error', {}).get('message',''))[:60]}")

            print("\n  campos do objeto media (Facebook Login):")
            first = list(SAMPLE_IDS.values())[0]
            for f in MEDIA_FIELDS:
                res = request("graph.facebook.com", "v26.0", first,
                              {"fields": f, "access_token": PAGE_TOKEN})
                ok, val = record(f, "Facebook Login", "graph.facebook.com", "v26.0",
                                 "/{media-id}?fields=", first, res)
                print(f"    {'✓' if ok else '✗'} {f:24} "
                      f"{res['body'].get(f) if ok else (res['body'].get('error',{}).get('message',''))[:55]}")

            print("\n  métricas contestadas x versões (Facebook Login):")
            for metric in CONTESTED:
                line = f"    {metric:22}"
                for v in CONTESTED_VERSIONS:
                    res = request("graph.facebook.com", v, f"{first}/insights",
                                  {"metric": metric, "access_token": PAGE_TOKEN})
                    ok, _ = record(metric, "Facebook Login", "graph.facebook.com", v,
                                   "/{media-id}/insights", first, res)
                    line += f"  {v}={'✓' if ok else '✗'}"
                print(line)


# ===================================================================== RESUMO
hr("RESUMO — Instagram Login  x  Facebook Login")
print(f"  {'métrica':32} {'IG Login':>12} {'FB Login':>12}")
print("  " + "-" * 58)
for metric in METRICS:
    a = any(results_a.get((metric, lbl), False) for lbl, _ in SAMPLES if lbl.startswith("REELS"))
    if results_b:
        b = any(results_b.get((metric, lbl), False) for lbl in SAMPLE_IDS if lbl.startswith("REELS"))
        bs = "✓" if b else "✗"
    else:
        bs = "não testado"
    print(f"  {metric:32} {('✓' if a else '✗'):>12} {bs:>12}")
print("\n  (coluna = a métrica funcionou em ao menos um REELS)")

out = pathlib.Path(__file__).parent / "out"
out.mkdir(exist_ok=True)
dest = out / "compare-logins.json"
dest.write_text(json.dumps({
    "executado_em": datetime.now(timezone.utc).isoformat(),
    "chamadas": CALLS,
    "midias_testadas": SAMPLE_IDS,
    "testes": LOG,
}, ensure_ascii=False, indent=2))
print(f"\n  {CALLS} chamadas. Log bruto completo: {dest}")
