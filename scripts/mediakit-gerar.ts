/** Gera um media kit pela linha de comando (mesmo caminho da aba). Uso: npx tsx --conditions=react-server scripts/mediakit-gerar.ts [cliente] [valor] */
import { coletarNumeros, registrarGeracao, rotuloMes } from '../lib/analytics/media-kit'
async function main() {
  const cliente = process.argv[2] || null
  const valor = process.argv[3] ? Number(process.argv[3]) : 600
  const n = await coletarNumeros()
  const id = await registrarGeracao({ cliente, valor, numeros: n, por: 'cli' })
  console.log(JSON.stringify({ id, rotulo: rotuloMes(n.geradoEm), seguidores: n.seguidores, cases: n.cases.map((c) => c.handle), manual: n.manual }, null, 1))
}
main()
