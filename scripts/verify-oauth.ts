/**
 * Exercita o MESMO código do callback do OAuth, usando o token longo que já
 * temos, sem precisar do navegador. Prova a cadeia inteira:
 *   token longo → Página correta → Page Token → perfil → cripto → banco.
 */
import { resolveAccount, fetchProfile, fetchGrantedScopes } from '../lib/instagram/auth'
import { encryptToken, decryptToken, toPgBytea, fromPgBytea } from '../lib/crypto'
import { db } from '../lib/db'

async function main() {
  const userToken = process.env.META_DEV_FB_LONGLIVED_TOKEN!

  console.log('1. resolveAccount — escolhe a Página certa entre as 8?')
  const account = await resolveAccount(userToken)
  console.log(`   Página: ${account.pageName} (${account.pageId})`)
  console.log(`   Instagram: @${account.username} (${account.instagramUserId})`)
  console.log(`   alvo configurado: ${process.env.META_TARGET_IG_USER_ID}`)
  console.log(`   ✓ confere: ${account.instagramUserId === process.env.META_TARGET_IG_USER_ID}`)

  console.log('\n2. perfil via Page Token')
  const profile = await fetchProfile(account.instagramUserId, account.pageAccessToken)
  console.log(`   @${profile.username} · ${profile.followers_count} seguidores · ${profile.media_count} mídias`)

  console.log('\n3. permissões concedidas')
  const scopes = await fetchGrantedScopes(userToken)
  console.log(`   ${scopes.length} permissões`)

  console.log('\n4. criptografia do token — ida e volta')
  const enc = encryptToken(account.pageAccessToken)
  const dec = decryptToken(enc)
  console.log(`   cifrado: ${enc.length} bytes · decifra idêntico: ${dec === account.pageAccessToken}`)
  console.log(`   texto puro aparece no blob? ${enc.toString('utf8').includes(account.pageAccessToken.slice(0, 20))}`)

  console.log('\n5. persistência (mesmo upsert do callback)')
  const { data, error } = await db().from('instagram_accounts').upsert({
    instagram_user_id: account.instagramUserId,
    username: profile.username,
    name: profile.name ?? null,
    profile_picture_url: profile.profile_picture_url ?? null,
    followers_count: profile.followers_count ?? null,
    follows_count: profile.follows_count ?? null,
    media_count: profile.media_count ?? null,
    facebook_page_id: account.pageId,
    facebook_page_name: account.pageName,
    page_access_token_encrypted: toPgBytea(encryptToken(account.pageAccessToken)),
    user_access_token_encrypted: toPgBytea(encryptToken(userToken)),
    scopes,
    connection_status: 'CONNECTED',
  }, { onConflict: 'instagram_user_id' }).select('id,username,followers_count').single()
  if (error) { console.error('   ✗', error.message); process.exit(1) }
  console.log(`   ✓ gravado: ${data.username} · ${data.followers_count} seguidores`)

  console.log('\n6. o token volta do banco decifrável?')
  const { data: row } = await db().from('instagram_accounts')
    .select('page_access_token_encrypted').eq('id', data.id).single()
  const back = decryptToken(fromPgBytea(row!.page_access_token_encrypted)!)
  console.log(`   ✓ round-trip pelo Postgres: ${back === account.pageAccessToken}`)

  await db().from('account_snapshots').insert({
    instagram_account_id: data.id, followers_count: profile.followers_count,
    follows_count: profile.follows_count, media_count: profile.media_count,
    source: 'oauth_connect',
  })
  console.log('\n7. snapshot inicial gravado — a série histórica começa agora')
}

main().catch((e) => { console.error(e); process.exit(1) })
