import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL } from '@/lib/legal'
import {
  Callout,
  DataTable,
  Item,
  List,
  MailLink,
  P,
  Section,
  Strong,
} from '../_components/legal-ui'

export const metadata: Metadata = {
  title: 'Termos de Uso',
  description:
    'Condições de uso do Painel Vamo Nessa, ferramenta interna de análise e relacionamento do Instagram @vamonessasp.',
}

export default function TermsPage() {
  return (
    <article>
      <header className="mb-12">
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
          Documento legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
          Termos de Uso
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-soft">
          Estas condições regem o uso do {LEGAL.appName}, ferramenta interna de análise de
          crescimento e relacionamento da conta {LEGAL.instagramHandle} no Instagram.
        </p>
        <p className="mt-4 text-sm text-ink-faint">
          Vigente desde{' '}
          <time dateTime={LEGAL.lastUpdatedISO}>{LEGAL.lastUpdatedLabel}</time>.
        </p>
      </header>

      <div className="space-y-10">
        <Section id="objeto" n={1} title="Objeto e natureza da ferramenta">
          <P>
            O {LEGAL.appName} é um software <Strong>privado, interno e de acesso restrito</Strong>,
            desenvolvido para uso próprio na administração da conta profissional{' '}
            {LEGAL.instagramHandle}. Ele permite:
          </P>
          <List>
            <Item>visualizar métricas oficiais da conta e das publicações;</Item>
            <Item>acompanhar a evolução do número de seguidores ao longo do tempo;</Item>
            <Item>organizar os comentários recebidos nas publicações;</Item>
            <Item>
              enviar respostas privadas a quem comentou, por meio do recurso oficial da API da Meta.
            </Item>
          </List>
          <P>
            Não é um serviço oferecido ao público, não há oferta comercial, não há cadastro aberto e
            não há contratação por terceiros.
          </P>
        </Section>

        <Section id="acesso" n={2} title="Quem pode acessar">
          <P>
            O acesso é limitado a operadores autorizados, identificados por e-mail previamente
            incluído em lista de permissão. Cada operador é responsável por:
          </P>
          <List>
            <Item>manter a confidencialidade do seu acesso;</Item>
            <Item>não compartilhar credenciais;</Item>
            <Item>comunicar imediatamente qualquer suspeita de uso indevido.</Item>
          </List>
          <P>
            O acesso pode ser suspenso ou revogado a qualquer momento, sem aviso prévio, em caso de
            uso indevido.
          </P>
        </Section>

        <Section id="integracao" n={3} title="Integração com a Meta">
          <P>
            A ferramenta opera exclusivamente por meio das <Strong>APIs oficiais da Meta</Strong>{' '}
            (Instagram Platform / Graph API), mediante autorização concedida pelo administrador da
            conta através do fluxo oficial de login. O uso está subordinado às políticas da Meta,
            incluindo os Termos da Plataforma Meta, as Políticas do Desenvolvedor e as Diretrizes da
            Comunidade do Instagram.
          </P>
          <Callout tone="warn" title="Condutas expressamente proibidas">
            <List>
              <Item>
                <Strong>Scraping</Strong> ou qualquer coleta de dados fora da API oficial.
              </Item>
              <Item>
                <Strong>Login automatizado</Strong> ou uso de credenciais de acesso de terceiros.
              </Item>
              <Item>Uso de APIs não oficiais, proxies de contorno ou serviços intermediários não autorizados.</Item>
              <Item>
                Tentativa de <Strong>burlar limites de uso</Strong> (rate limits), fragmentar
                requisições para escapar de contagem ou reenviar chamadas bloqueadas.
              </Item>
              <Item>Envio de mensagens não solicitadas a quem não interagiu com os conteúdos.</Item>
              <Item>
                Envio de mais de uma resposta privada por comentário, ou envio fora do prazo
                permitido pela Meta.
              </Item>
              <Item>Conteúdo enganoso, ofensivo, discriminatório ou ilícito nas mensagens.</Item>
            </List>
          </Callout>
          <P>
            A Meta pode alterar, restringir ou descontinuar recursos da sua API a qualquer momento.
            Nesse caso, funcionalidades da ferramenta podem deixar de existir sem que isso configure
            defeito.
          </P>
        </Section>

        <Section id="mensagens" n={4} title="Regras das mensagens privadas">
          <P>
            As mensagens privadas usam exclusivamente o recurso oficial de resposta privada
            (private reply). Regras aplicadas pela ferramenta:
          </P>
          <DataTable
            columns={['Regra', 'Como é garantida']}
            rows={[
              [
                'Uma única mensagem por comentário, em definitivo',
                'Restrição de unicidade no banco de dados, não apenas verificação em tela',
              ],
              [
                'Envio somente dentro do prazo da Meta (hoje 7 dias da criação do comentário)',
                'Prazo revalidado no servidor no instante do envio, não no momento da seleção',
              ],
              [
                'Somente para quem comentou publicamente',
                'O destinatário é identificado pelo próprio comentário, não por lista externa',
              ],
              [
                'Respeito aos limites de uso da API',
                'Fila com teto de envios por hora e recuo progressivo em caso de bloqueio',
              ],
              [
                'Sem envio duplicado em caso de nova tentativa',
                'Idempotência por identificador do comentário',
              ],
              [
                'Texto registrado como usado',
                'A mensagem de uma campanha executada é congelada e nunca alterada retroativamente',
              ],
            ]}
          />
          <P>
            Cabe ao operador o conteúdo das mensagens. É proibido usar a ferramenta para spam,
            propaganda enganosa, assédio ou qualquer prática vedada pelas políticas da Meta ou pela
            legislação brasileira.
          </P>
        </Section>

        <Section id="metricas" n={5} title="Sobre as métricas exibidas">
          <P>
            Todas as métricas exibidas provêm da API da Meta. Consequências que o operador precisa
            conhecer:
          </P>
          <List>
            <Item>
              Diversas métricas são declaradas pela própria Meta como{' '}
              <Strong>estimativas</Strong> e podem ser revisadas por ela.
            </Item>
            <Item>
              Quando uma métrica não é fornecida pela Meta, a ferramenta exibe{' '}
              <Strong>&ldquo;não disponível&rdquo;</Strong> — e nunca zero. Ausência de dado e
              resultado zero são coisas distintas e permanecem distintas em todo o sistema.
            </Item>
            <Item>
              Nenhuma métrica é estimada, interpolada ou inventada pela ferramenta.
            </Item>
          </List>
          <Callout tone="warn" title="Correlação não é causalidade">
            <P>
              A API da Meta <Strong>não fornece atribuição individual</Strong> de novos seguidores a
              um conteúdo específico (no caso dos Reels, não fornece atribuição alguma) nem a uma
              mensagem enviada. Por isso a ferramenta apresenta apenas o{' '}
              <Strong>crescimento observado da conta após a publicação</Strong> ou durante o período
              de uma campanha — uma associação temporal, jamais uma relação de causa e efeito.
            </P>
            <P className="mt-2">
              Nenhuma indicação da ferramenta deve ser lida como garantia de que um conteúdo ou uma
              mensagem gerou seguidores.
            </P>
          </Callout>
        </Section>

        <Section id="disponibilidade" n={6} title="Disponibilidade e garantias">
          <P>
            A ferramenta é fornecida <Strong>&ldquo;no estado em que se encontra&rdquo;</Strong>,
            sem garantia de disponibilidade contínua, ausência de erros ou adequação a uma
            finalidade específica. O funcionamento depende de serviços de terceiros (Meta, Supabase,
            Vercel) e pode ser interrompido por indisponibilidade deles, expiração de token,
            alteração de permissões ou mudanças na API.
          </P>
          <P>
            Não há garantia de crescimento de seguidores, alcance, engajamento ou qualquer resultado
            de negócio.
          </P>
        </Section>

        <Section id="responsabilidade" n={7} title="Limitação de responsabilidade">
          <P>
            Na máxima extensão permitida pela lei, o responsável pela ferramenta não se
            responsabiliza por lucros cessantes, perda de dados, interrupção de atividades ou danos
            indiretos decorrentes do uso ou da impossibilidade de uso da ferramenta, especialmente
            quando originados de:
          </P>
          <List>
            <Item>indisponibilidade, alteração ou descontinuidade das APIs da Meta;</Item>
            <Item>restrição, suspensão ou banimento da conta do Instagram pela Meta;</Item>
            <Item>decisões de negócio tomadas com base nas métricas exibidas;</Item>
            <Item>uso das mensagens em desacordo com estes termos.</Item>
          </List>
        </Section>

        <Section id="propriedade" n={8} title="Propriedade intelectual">
          <P>
            O código, a interface e a documentação da ferramenta pertencem ao seu titular. Os
            conteúdos do Instagram (vídeos, imagens, legendas) permanecem de titularidade de quem os
            criou. Comentários pertencem às pessoas que os escreveram e são tratados conforme a{' '}
            <Link href="/privacy" className="text-accent underline underline-offset-2">
              Política de Privacidade
            </Link>
            . &ldquo;Instagram&rdquo;, &ldquo;Meta&rdquo; e marcas relacionadas pertencem à Meta
            Platforms; esta ferramenta não é afiliada, patrocinada nem endossada pela Meta.
          </P>
        </Section>

        <Section id="privacidade" n={9} title="Privacidade e exclusão de dados">
          <P>
            O tratamento de dados pessoais está descrito na{' '}
            <Link href="/privacy" className="text-accent underline underline-offset-2">
              Política de Privacidade
            </Link>
            , que integra estes termos. Pedidos de exclusão seguem o procedimento de{' '}
            <Link href="/data-deletion" className="text-accent underline underline-offset-2">
              Exclusão de dados
            </Link>
            .
          </P>
        </Section>

        <Section id="alteracoes" n={10} title="Alterações e vigência">
          <P>
            Estes termos podem ser alterados a qualquer momento; a data de vigência no topo indica a
            versão atual. O uso continuado após a atualização implica concordância. A ferramenta pode
            ser descontinuada a qualquer momento, hipótese em que os dados serão excluídos conforme
            os prazos de retenção da Política de Privacidade.
          </P>
        </Section>

        <Section id="lei" n={11} title="Lei aplicável e foro">
          <P>
            Aplica-se a legislação brasileira, em especial a Lei nº 13.709/2018 (LGPD) e a Lei nº
            12.965/2014 (Marco Civil da Internet). Fica eleito o foro do domicílio do titular da
            ferramenta para dirimir controvérsias, salvo hipótese de foro obrigatório por lei.
          </P>
          <P>
            Contato: <MailLink address={LEGAL.privacyEmail} />
          </P>
        </Section>
      </div>
    </article>
  )
}
