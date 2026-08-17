import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL } from '@/lib/legal'
import {
  Callout,
  Code,
  DataTable,
  Item,
  List,
  MailLink,
  P,
  Section,
  Strong,
} from '../_components/legal-ui'

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description:
    'Como o Painel Vamo Nessa coleta, usa, armazena e exclui dados obtidos pelas APIs oficiais da Meta.',
}

export default function PrivacyPage() {
  return (
    <article>
      <header className="mb-12">
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
          Documento legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
          Política de Privacidade
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-soft">
          Esta política explica quais dados o {LEGAL.appName} coleta por meio das APIs oficiais
          da Meta, para que os usa, com quem compartilha, por quanto tempo guarda e como qualquer
          pessoa pode pedir a exclusão dos seus dados.
        </p>
        <p className="mt-4 text-sm text-ink-faint">
          Vigente desde{' '}
          <time dateTime={LEGAL.lastUpdatedISO}>{LEGAL.lastUpdatedLabel}</time>.
        </p>
      </header>

      <div className="space-y-10">
        <Section id="quem-somos" n={1} title="Quem é o responsável">
          <P>
            O {LEGAL.appName} é uma ferramenta <Strong>interna e de acesso restrito</Strong>, usada
            exclusivamente pela administração da conta profissional do Instagram{' '}
            {LEGAL.instagramHandle} para acompanhar o desempenho dos próprios conteúdos e responder
            a quem interage com eles. Não é um serviço aberto ao público, não aceita cadastro de
            terceiros e não é oferecido comercialmente.
          </P>
          <P>
            O tratamento de dados descrito aqui é realizado pela administração de{' '}
            {LEGAL.instagramHandle}, que atua como controladora nos termos da Lei Geral de Proteção
            de Dados (Lei nº 13.709/2018 — LGPD). Para qualquer assunto relacionado a privacidade,
            incluindo o exercício dos direitos previstos na seção 9, o canal de contato é:
          </P>
          <P>
            <MailLink address={LEGAL.privacyEmail} />
          </P>
        </Section>

        <Section id="origem" n={2} title="De onde vêm os dados">
          <P>
            Todos os dados são obtidos <Strong>exclusivamente pelas APIs oficiais da Meta</Strong>{' '}
            (Instagram Platform / Graph API), após autorização explícita do administrador da conta
            {' '}{LEGAL.instagramHandle} por meio do fluxo oficial de login (OAuth).
          </P>
          <Callout title="O que nunca fazemos">
            <List>
              <Item>
                Não usamos <Strong>scraping</Strong>, raspagem de páginas ou coleta automatizada
                fora da API.
              </Item>
              <Item>
                Não realizamos <Strong>login automatizado</Strong> nem pedimos, armazenamos ou
                utilizamos senhas do Instagram de ninguém.
              </Item>
              <Item>Não utilizamos APIs não oficiais, intermediários ou serviços de terceiros não autorizados pela Meta.</Item>
              <Item>Não compramos, vendemos, alugamos nem enriquecemos listas de contatos.</Item>
            </List>
          </Callout>
        </Section>

        <Section id="dados" n={3} title="Quais dados tratamos">
          <P>
            <Strong>a) Dados da conta conectada ({LEGAL.instagramHandle})</Strong>
          </P>
          <List>
            <Item>
              Identificador da conta, nome de usuário, nome de exibição, foto de perfil, tipo de
              conta, número de seguidores e número de publicações.
            </Item>
            <Item>
              Publicações: identificador, tipo, legenda, link permanente, miniatura e data/hora de
              publicação.
            </Item>
            <Item>
              Métricas oficiais de desempenho (Instagram Insights) da conta e de cada publicação —
              por exemplo visualizações, alcance, curtidas, comentários, compartilhamentos,
              salvamentos e tempo de exibição, conforme a Meta disponibilizar.
            </Item>
            <Item>
              Token de acesso emitido pela Meta, armazenado de forma criptografada e usado somente
              pelo servidor.
            </Item>
          </List>

          <P>
            <Strong>b) Dados de pessoas que interagem publicamente com os conteúdos</Strong>
          </P>
          <P>
            Quando alguém comenta publicamente em uma publicação de {LEGAL.instagramHandle},
            recebemos da Meta e armazenamos:
          </P>
          <List>
            <Item>o identificador do comentário e da publicação comentada;</Item>
            <Item>
              o nome de usuário (@) e o identificador da pessoa no escopo do aplicativo (IGSID),
              quando a Meta os fornece;
            </Item>
            <Item>o texto do comentário e a data/hora em que foi publicado;</Item>
            <Item>
              o registro de que uma resposta privada foi enviada, quando enviada, e o resultado
              técnico desse envio (sucesso, erro ou motivo de inelegibilidade).
            </Item>
          </List>
          <P>
            Também registramos o conteúdo das mensagens privadas que <em>nós</em> enviamos e, se a
            pessoa responder, o conteúdo dessa resposta — porque ela chega à caixa de entrada da
            conta e é o único indicador oficial de que a mensagem teve retorno.
          </P>

          <Callout tone="warn" title="Não temos acesso a">
            Lista de seguidores, identidade de quem seguiu ou deixou de seguir a conta, dados de
            contato (e-mail, telefone, endereço), localização, dados de navegação fora do Instagram
            ou qualquer informação de pessoas que não tenham interagido publicamente com os
            conteúdos. A API da Meta não fornece esses dados e não tentamos obtê-los por outros
            meios.
          </Callout>
        </Section>

        <Section id="finalidades" n={4} title="Para que usamos">
          <DataTable
            columns={['Finalidade', 'Dados usados', 'Base legal (LGPD)']}
            rows={[
              [
                'Acompanhar o crescimento da conta e o desempenho dos conteúdos',
                'Métricas da conta e das publicações, histórico de seguidores',
                'Legítimo interesse (art. 7º, IX) — dados da própria conta',
              ],
              [
                'Organizar e visualizar os comentários recebidos',
                'Nome de usuário, texto e data do comentário',
                'Legítimo interesse (art. 7º, IX) — o comentário é público e dirigido à conta',
              ],
              [
                'Responder de forma privada a quem comentou, agradecendo e convidando a seguir',
                'Identificador do comentário e da pessoa, texto enviado',
                'Legítimo interesse (art. 7º, IX), no contexto de contato iniciado pela própria pessoa ao comentar',
              ],
              [
                'Segurança, prevenção de envio duplicado e auditoria técnica',
                'Registros de eventos, erros e sincronizações',
                'Cumprimento de obrigação e legítimo interesse (art. 7º, II e IX)',
              ],
            ]}
          />
          <P>
            <Strong>Não</Strong> usamos esses dados para publicidade direcionada, criação de
            perfis comportamentais, decisões automatizadas com efeito jurídico, revenda ou
            compartilhamento comercial.
          </P>
        </Section>

        <Section id="mensagens" n={5} title="Mensagens privadas (private replies)">
          <P>
            A ferramenta pode enviar <Strong>uma única mensagem privada</Strong> a quem comentou,
            usando exclusivamente o recurso oficial de resposta privada da API da Meta. Isso está
            sujeito a regras da própria plataforma, que respeitamos integralmente:
          </P>
          <List>
            <Item>
              a mensagem só pode ser enviada dentro do prazo definido pela Meta a partir da criação
              do comentário (atualmente <Strong>7 dias</Strong>);
            </Item>
            <Item>
              é permitida <Strong>apenas uma</Strong> resposta privada por comentário, de forma
              definitiva — nossa base de dados impede tecnicamente um segundo envio;
            </Item>
            <Item>
              adicionalmente, por decisão própria, evitamos enviar mais de uma mensagem para a
              mesma pessoa, mesmo que ela comente várias vezes;
            </Item>
            <Item>
              respeitamos as configurações de privacidade de cada pessoa: se ela bloqueia
              solicitações de mensagem, o envio simplesmente falha e nada é reenviado;
            </Item>
            <Item>
              respeitamos os limites de uso da API e nunca tentamos contorná-los.
            </Item>
          </List>
          <P>
            Detalhes operacionais estão em{' '}
            <Link href="/terms" className="text-accent underline underline-offset-2">
              Termos de uso
            </Link>
            .
          </P>
        </Section>

        <Section id="compartilhamento" n={6} title="Com quem compartilhamos">
          <P>
            Não vendemos e não compartilhamos dados para fins comerciais. Utilizamos apenas os
            prestadores de infraestrutura necessários para o funcionamento da ferramenta, na
            condição de operadores:
          </P>
          <DataTable
            columns={['Prestador', 'Função', 'Localização']}
            rows={[
              ['Meta Platforms', 'Origem dos dados e envio das mensagens privadas', 'Estados Unidos e outros'],
              ['Supabase', 'Banco de dados, autenticação e armazenamento', 'Servidores em nuvem (região configurada)'],
              ['Vercel', 'Hospedagem e execução da aplicação', 'Estados Unidos e outros'],
            ]}
          />
          <P>
            Esses provedores podem processar dados fora do Brasil. A transferência internacional
            ocorre com base no art. 33 da LGPD e nas cláusulas contratuais e políticas de
            privacidade de cada provedor. Também poderemos divulgar dados quando houver obrigação
            legal, ordem de autoridade competente ou necessidade de defesa em processo.
          </P>
        </Section>

        <Section id="retencao" n={7} title="Por quanto tempo guardamos">
          <DataTable
            columns={['Dado', 'Retenção', 'Motivo']}
            rows={[
              [
                'Histórico de seguidores e métricas da conta',
                'Enquanto a ferramenta estiver em uso',
                'É a série histórica que dá sentido ao produto; não contém dados de terceiros',
              ],
              [
                'Publicações e métricas por publicação',
                'Enquanto a ferramenta estiver em uso',
                'Análise de desempenho ao longo do tempo',
              ],
              [
                'Comentários (usuário e texto)',
                'Até 180 dias após o fim do prazo de resposta, salvo pedido anterior de exclusão',
                'Operação da fila de mensagens e prevenção de envio duplicado',
              ],
              [
                'Registro de mensagens enviadas',
                'Até 24 meses',
                'Impedir tecnicamente um segundo envio para o mesmo comentário e auditar campanhas',
              ],
              [
                'Token de acesso da conta',
                'Até a desconexão da conta ou expiração',
                'Autenticação junto à Meta; excluído imediatamente na desconexão',
              ],
              [
                'Registros técnicos (logs, eventos de webhook)',
                'Até 90 dias',
                'Segurança e diagnóstico',
              ],
            ]}
          />
          <P>
            Encerrado o prazo, os dados são excluídos ou irreversivelmente anonimizados. Métricas
            agregadas e anonimizadas — que não permitem identificar ninguém — podem ser mantidas
            para preservar a série histórica.
          </P>
        </Section>

        <Section id="seguranca" n={8} title="Como protegemos">
          <List>
            <Item>
              Tokens de acesso <Strong>criptografados em repouso</Strong> e descriptografados
              apenas na memória do servidor, no momento do uso.
            </Item>
            <Item>
              Chaves e segredos existem <Strong>somente no servidor</Strong>; nunca são enviados ao
              navegador nem incluídos no código do frontend.
            </Item>
            <Item>
              Notificações recebidas da Meta (webhooks) só são aceitas após validação da assinatura
              criptográfica <Code>X-Hub-Signature-256</Code>; requisições não assinadas são
              descartadas.
            </Item>
            <Item>
              Banco de dados com <Strong>Row Level Security</Strong> ativa em todas as tabelas e
              acesso ao painel restrito a e-mails previamente autorizados.
            </Item>
            <Item>
              Registros técnicos com redação automática de tokens, assinaturas e segredos — esses
              valores nunca são gravados em log.
            </Item>
            <Item>Comunicação sempre por HTTPS.</Item>
          </List>
          <P>
            Nenhum sistema é totalmente imune. Em caso de incidente com risco relevante,
            comunicaremos os titulares afetados e a Autoridade Nacional de Proteção de Dados nos
            termos do art. 48 da LGPD.
          </P>
        </Section>

        <Section id="direitos" n={9} title="Seus direitos">
          <P>
            Se você comentou em um conteúdo do {LEGAL.instagramHandle}, você tem direito, a
            qualquer momento e sem custo, a:
          </P>
          <List>
            <Item>confirmar se tratamos dados seus e acessá-los;</Item>
            <Item>corrigir dados incompletos, inexatos ou desatualizados;</Item>
            <Item>
              solicitar anonimização, bloqueio ou <Strong>eliminação</Strong> de dados
              desnecessários ou tratados em desconformidade;
            </Item>
            <Item>solicitar a portabilidade dos dados;</Item>
            <Item>
              <Strong>opor-se</Strong> ao tratamento fundado em legítimo interesse, inclusive
              pedindo para não receber mensagens;
            </Item>
            <Item>obter informação sobre com quem compartilhamos seus dados;</Item>
            <Item>revogar o consentimento, quando o tratamento se basear nele.</Item>
          </List>
          <P>
            Para exercer qualquer um desses direitos, escreva para{' '}
            <MailLink address={LEGAL.privacyEmail} />. Responderemos em até 15 dias. Para exclusão,
            veja o procedimento detalhado em{' '}
            <Link href="/data-deletion" className="text-accent underline underline-offset-2">
              Exclusão de dados
            </Link>
            .
          </P>
        </Section>

        <Section id="criancas" n={10} title="Crianças e adolescentes">
          <P>
            A ferramenta não é destinada a menores de 13 anos e não coleta dados intencionalmente
            dessa faixa etária. O Instagram exige idade mínima de 13 anos. Ao identificarmos dados
            de uma criança, os excluiremos.
          </P>
        </Section>

        <Section id="mudancas" n={11} title="Alterações nesta política">
          <P>
            Podemos atualizar este documento para refletir mudanças na ferramenta, nas APIs da Meta
            ou na legislação. A data de vigência no topo da página sempre indica a versão atual.
            Mudanças relevantes serão sinalizadas nesta própria página.
          </P>
        </Section>

        <Section id="contato" n={12} title="Contato">
          <P>
            Dúvidas, pedidos ou reclamações sobre privacidade:{' '}
            <MailLink address={LEGAL.privacyEmail} />.
          </P>
          <P>
            Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados
            (ANPD).
          </P>
        </Section>
      </div>
    </article>
  )
}
