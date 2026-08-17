import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL } from '@/lib/legal'
import {
  Callout,
  Code,
  DataTable,
  Item,
  List,
  P,
  Pending,
  Section,
  Step,
  Steps,
  Strong,
} from '../_components/legal-ui'

export const metadata: Metadata = {
  title: 'Exclusão de Dados',
  description:
    'Como solicitar a exclusão dos seus dados do Painel Vamo Nessa, o que é excluído e em quanto tempo.',
}

export default function DataDeletionPage() {
  return (
    <article>
      <header className="mb-12">
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink-faint">
          Documento legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
          Exclusão de Dados
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-soft">
          Esta página explica como pedir a exclusão dos dados que o {LEGAL.appName} guarda sobre
          você, exatamente o que é apagado e em quanto tempo. O pedido é gratuito e não exige
          justificativa.
        </p>
        <p className="mt-4 text-sm text-ink-faint">
          Atualizado em{' '}
          <time dateTime={LEGAL.lastUpdatedISO}>{LEGAL.lastUpdatedLabel}</time>.
        </p>
      </header>

      <div className="space-y-10">
        <Section id="quem" n={1} title="Isso se aplica a você?">
          <P>
            O {LEGAL.appName} é uma ferramenta interna usada para administrar a conta{' '}
            {LEGAL.instagramHandle}. Ela guarda dados de duas situações apenas:
          </P>
          <List>
            <Item>
              <Strong>Você comentou publicamente</Strong> em uma publicação do{' '}
              {LEGAL.instagramHandle}. Nesse caso guardamos seu nome de usuário (@), o texto do
              comentário, a data e o registro de eventual mensagem privada enviada a você.
            </Item>
            <Item>
              <Strong>Você respondeu a uma mensagem privada</Strong> enviada pela conta. Nesse caso
              guardamos também o texto dessa resposta.
            </Item>
          </List>
          <P>
            Se você nunca comentou nem trocou mensagens com {LEGAL.instagramHandle},{' '}
            <Strong>não temos nenhum dado seu</Strong> — não coletamos dados de seguidores, de quem
            apenas assistiu ou curtiu um vídeo, nem de qualquer pessoa fora dessas duas situações.
          </P>
        </Section>

        <Section id="pedir" n={2} title="Como pedir a exclusão">
          <P>
            <Strong>Caminho 1 — Pedido direto (recomendado).</Strong> Envie um e-mail para{' '}
            <Pending value={LEGAL.privacyEmail} /> com:
          </P>
          <Steps>
            <Step>
              o assunto <Code>Exclusão de dados</Code>;
            </Step>
            <Step>
              seu <Strong>nome de usuário do Instagram</Strong> (o @) — é o identificador que
              usamos para localizar seus registros;
            </Step>
            <Step>
              opcionalmente, o link da publicação onde você comentou, o que agiliza a localização.
            </Step>
          </Steps>
          <P>
            Confirmamos o recebimento e concluímos a exclusão em{' '}
            <Strong>até 15 dias corridos</Strong>, informando você ao final. Se por algum motivo não
            for possível excluir algum dado, explicaremos qual e por quê.
          </P>

          <P className="pt-2">
            <Strong>Caminho 2 — Revogar o acesso do aplicativo no Instagram.</Strong> Você pode
            remover a autorização da ferramenta diretamente no Instagram:
          </P>
          <Steps>
            <Step>abra o aplicativo do Instagram e vá em seu perfil;</Step>
            <Step>
              acesse <Code>Configurações e privacidade</Code>;
            </Step>
            <Step>
              vá em <Code>Segurança da conta</Code> →{' '}
              <Code>Aplicativos e sites</Code> (em algumas versões, em{' '}
              <Code>Privacidade</Code> → <Code>Mensagens</Code> →{' '}
              <Code>Ferramentas conectadas</Code>);
            </Step>
            <Step>
              localize o aplicativo na lista e selecione <Code>Remover</Code>.
            </Step>
          </Steps>
          <P>
            Quando a Meta nos notifica a revogação, tratamos o evento como um pedido de exclusão e
            apagamos os dados associados, sem necessidade de qualquer outra ação sua.
          </P>

          <Callout title="Se você administra a conta conectada">
            Basta usar o botão <Strong>Desconectar Instagram</Strong> em Configurações → Instagram,
            dentro do painel. O token de acesso é destruído imediatamente e nenhuma nova
            sincronização ou mensagem é possível.
          </Callout>
        </Section>

        <Section id="o-que" n={3} title="O que é excluído">
          <DataTable
            columns={['Dado', 'O que acontece']}
            rows={[
              ['Seu nome de usuário (@) e identificador', 'Excluído'],
              ['Texto e data dos seus comentários', 'Excluídos'],
              ['Conteúdo de mensagens privadas trocadas com você', 'Excluído'],
              [
                'Registro técnico de que uma resposta privada foi enviada',
                'Mantido de forma anonimizada, sem qualquer identificador seu, apenas para impedir tecnicamente um novo envio para o mesmo comentário',
              ],
              [
                'Métricas agregadas (total de comentários no dia, alcance de um vídeo)',
                'Mantidas — são números somados que não identificam ninguém',
              ],
            ]}
          />
          <P>
            A exclusão é <Strong>definitiva e irreversível</Strong>: não mantemos backup dos dados
            excluídos além dos ciclos técnicos de retenção da infraestrutura, que se sobrescrevem em
            até 30 dias.
          </P>
        </Section>

        <Section id="limites" n={4} title="O que não podemos excluir">
          <P>Alguns dados estão fora do nosso alcance. Por transparência:</P>
          <List>
            <Item>
              <Strong>Seu comentário no Instagram.</Strong> Ele vive nos servidores da Meta, não
              nos nossos. Apagar nossos registros não remove o comentário do post — para isso, apague
              o comentário pelo próprio aplicativo do Instagram.
            </Item>
            <Item>
              <Strong>A mensagem privada na sua caixa de entrada.</Strong> Ela pertence à sua conta
              no Instagram; você pode excluí-la ou denunciá-la lá.
            </Item>
            <Item>
              <Strong>Dados que a Meta mantém.</Strong> Consulte a Política de Privacidade da Meta
              para exercer seus direitos junto a ela.
            </Item>
            <Item>
              Dados que precisemos preservar por <Strong>obrigação legal</Strong> ou para defesa em
              processo — hipótese em que informaremos a base legal específica.
            </Item>
          </List>
        </Section>

        <Section id="nao-receber" n={5} title="Só não quero receber mensagens">
          <P>
            Se sua intenção é apenas não receber mensagens privadas, sem apagar nada, escreva para{' '}
            <Pending value={LEGAL.privacyEmail} /> pedindo{' '}
            <Strong>oposição ao envio de mensagens</Strong>. Adicionamos seu identificador a uma
            lista de exclusão permanente e você não será contatado novamente, mesmo que comente de
            novo.
          </P>
          <P>
            Vale lembrar que, por regra da própria Meta e por decisão nossa, cada comentário recebe{' '}
            <Strong>no máximo uma</Strong> mensagem, e evitamos enviar mais de uma mensagem por
            pessoa.
          </P>
        </Section>

        <Section id="direitos" n={6} title="Outros direitos">
          <P>
            Além da exclusão, a LGPD garante acesso, correção, portabilidade, oposição e informação
            sobre compartilhamento. Todos estão descritos na{' '}
            <Link href="/privacy" className="text-accent underline underline-offset-2">
              Política de Privacidade
            </Link>{' '}
            e podem ser exercidos pelo mesmo e-mail. Você também pode reclamar à Autoridade Nacional
            de Proteção de Dados (ANPD).
          </P>
        </Section>

        <Section id="contato" n={7} title="Contato">
          <P>
            Pedidos de exclusão e dúvidas sobre dados pessoais:{' '}
            <Pending value={LEGAL.privacyEmail} />
          </P>
          <P>
            Responsável: <Pending value={LEGAL.controllerName} /> —{' '}
            <Pending value={LEGAL.controllerLocation} />
          </P>
        </Section>
      </div>
    </article>
  )
}
