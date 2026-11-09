/**
 * Espera por uma pessoa quando a entrada parece resposta automática.
 *
 * A guarda do menu (`ehRespostaDeRobo`) só impede a passagem determinística
 * para a equipe. O turno seguia para o modelo, que respondia o menu, inventava
 * um pedido ou trocava emoji com o outro robô. Esta decisão é anterior: o
 * turno não envia, não passa para a equipe e não agenda.
 *
 * Erra para o lado de DEIXAR SEGUIR. Endereço, link e um horário combinado
 * por uma pessoa não são expediente fechado. Um pedido claro ("quero",
 * "pode mandar") também segue, salvo quando o texto é um menu que pede
 * para digitar a opção.
 *
 * O horário anunciado ("retornamos às 17:30") volta no resultado para quem
 * opera retomar uma vez. Este módulo não envia e não agenda.
 */
import { ehMensagemDeRobo, ehMenuDeOpcoesNumeradas } from "./human-handoff";

export interface MensagemParaEspera {
  direction: "inbound" | "outbound";
  body: string;
}

export type MotivoDaEspera = "menu" | "autodeclaracao" | "expediente" | "emoji" | "repetida";

export interface DecisaoDeEspera {
  esperar: boolean;
  motivo: MotivoDaEspera | null;
  /** Relógio no formato HH:MM. Não é um agendamento. */
  horarioAnunciado: string | null;
  /**
   * A primeira vez que este texto anuncia o expediente. A sugestão de
   * retomada é uma só; as repetições continuam sem envio e sem agenda.
   */
  sugerirRetomadaUnica: boolean;
}

const SEGUIR: DecisaoDeEspera = {
  esperar: false,
  motivo: null,
  horarioAnunciado: null,
  sugerirRetomadaUnica: false,
};

/** Frase institucional de quem fechou. "fechado" solto não entra: é aceite. */
const EXPEDIENTE_FECHADO: readonly RegExp[] = [
  /\bestamos fechados\b/,
  /\bloja fechada\b/,
  /\bexpediente encerrado\b/,
  /\bnao estamos atendendo\b/,
  /\bretornamos\b/,
  /\breabrimos\b/,
  /\breabre as\b/,
  /\bvoltamos a atender\b/,
  /\bretomamos o atendimento\b/,
];

/** Pessoa combinando entrega ou o próprio horário, não anunciando fechamento. */
const HORARIO_DE_PESSOA: readonly RegExp[] = [
  /\bmeu horario\b/,
  /\bpode ser\b/,
  /\bpode entregar\b/,
  /\bentrega as\b/,
  /\bentregar as\b/,
  /\bretirar as\b/,
  /\bbuscar as\b/,
];

/** Aceite claro. Não casa o rótulo de um menu que pede para digitar a opção. */
const ACEITE_CLARO: readonly RegExp[] = [
  /\b(?:quero|queria)\b/,
  /\bpode mandar\b/,
  /\bpode anotar\b/,
  /\baceito\b/,
  /\bconfirma o pedido\b/,
  /\bfecha o pedido\b/,
];

const ENDERECO: readonly RegExp[] = [
  /\brua\b/,
  /\bavenida\b/,
  /\bav\./,
  /\btravessa\b/,
  /\balameda\b/,
  /\bpraca\b/,
  /\bbairro\b/,
  /\bcep\b/,
  /\bapto\b/,
  /\bapartamento\b/,
  /\brecebedor\b/,
  /\bendereco\b/,
];

const INSTRUCAO_DE_MENU =
  /\bdigite\s+(?:o\s+|a\s+)?(?:numero|opcao|palavra)\b|\bopcao\s+desejada\b|\bmenu\s+(?:de\s+opcoes|abaixo|acima|principal)\b/;

const LINK = /https?:\/\/|www\./;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function esperar(
  motivo: MotivoDaEspera,
  horarioAnunciado: string | null,
  sugerirRetomadaUnica: boolean,
): DecisaoDeEspera {
  return { esperar: true, motivo, horarioAnunciado, sugerirRetomadaUnica };
}

/** "17:30", "17h30" e "17h" viram HH:MM. Sem relógio, null. */
export function horarioAnunciado(textoNormalizado: string): string | null {
  const comMinuto = textoNormalizado.match(/\b(\d{1,2})\s*(?::|h)\s*(\d{2})\b/);
  if (comMinuto) {
    const hora = Number(comMinuto[1]);
    const minuto = Number(comMinuto[2]);
    if (hora > 23 || minuto > 59) return null;
    return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  }
  const horaCheia = textoNormalizado.match(/\b(\d{1,2})\s*h\b/);
  if (!horaCheia) return null;
  const hora = Number(horaCheia[1]);
  if (hora > 23) return null;
  return `${String(hora).padStart(2, "0")}:00`;
}

function soEmoji(texto: string): boolean {
  if (!/\p{Extended_Pictographic}/u.test(texto)) return false;
  const resto = texto
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\s\p{P}\uFE0F\u200D]/gu, "");
  return resto.length === 0;
}

/**
 * Quantas vezes o mesmo texto já entrou. O histórico do turno inclui a
 * mensagem que está sendo decidida: uma ocorrência é ela mesma.
 */
function copiasAnteriores(mensagem: string, historico: readonly MensagemParaEspera[]): number {
  const alvo = normalizar(mensagem);
  if (alvo === "") return 0;
  let vistos = 0;
  for (const item of historico) {
    if (item.direction === "inbound" && normalizar(item.body) === alvo) vistos += 1;
  }
  return Math.max(0, vistos - 1);
}

export function decidirEsperaPorHumano(
  mensagem: string,
  historico: readonly MensagemParaEspera[] = [],
): DecisaoDeEspera {
  if (mensagem.trim() === "") return SEGUIR;
  const normalizada = normalizar(mensagem);
  const menu = ehMenuDeOpcoesNumeradas(mensagem);
  const aceite = ACEITE_CLARO.some((re) => re.test(normalizada));
  const instrucaoDeMenu = INSTRUCAO_DE_MENU.test(normalizada);

  if (menu && (instrucaoDeMenu || !aceite)) {
    return esperar("menu", null, false);
  }
  if (ENDERECO.some((re) => re.test(normalizada))) return SEGUIR;
  if (LINK.test(normalizada)) return SEGUIR;
  if (HORARIO_DE_PESSOA.some((re) => re.test(normalizada))) return SEGUIR;

  if (EXPEDIENTE_FECHADO.some((re) => re.test(normalizada))) {
    const repetida = copiasAnteriores(mensagem, historico) > 0;
    return esperar("expediente", horarioAnunciado(normalizada), !repetida);
  }
  if (ehMensagemDeRobo(mensagem)) return esperar("autodeclaracao", null, false);
  if (soEmoji(mensagem)) return esperar("emoji", null, false);
  if (copiasAnteriores(mensagem, historico) > 0) return esperar("repetida", null, false);
  if (aceite) return SEGUIR;
  return SEGUIR;
}

/** O histórico do turno, só com as direções que esta decisão lê. */
export function historicoParaEspera(
  messages: readonly { direction: string; body: string }[],
): MensagemParaEspera[] {
  return messages.flatMap((item) =>
    item.direction === "inbound" || item.direction === "outbound"
      ? [{ direction: item.direction, body: item.body }]
      : [],
  );
}

/** A primeira pendência que pede espera, ou null se todas seguem. */
export function algumaEntradaEspera(
  pendentes: readonly string[],
  historico: readonly MensagemParaEspera[] = [],
): DecisaoDeEspera | null {
  for (const texto of pendentes) {
    const decisao = decidirEsperaPorHumano(texto, historico);
    if (decisao.esperar) return decisao;
  }
  return null;
}
