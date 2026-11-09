/**
 * Lista já pronta para um rascunho de campanha.
 *
 * Não chama provedor de busca, não cria contato, não abre conversa e não
 * envia. Telefone publicado não é confirmação de WhatsApp nem consentimento.
 * O disparo continua no cartão "Iniciar abordagens", fora daqui.
 */
import { createHash } from "node:crypto";

export const FUSO_DA_LISTA = "America/Manaus";
export const LIMITE_DA_LISTA = 100;

export interface EmpresaDaLista {
  nome: string;
  telefone: string;
  fonte?: string | null;
  segmento?: string | null;
  endereco?: string | null;
}

export interface CandidatoDaLista {
  placeId: string;
  nome: string;
  telefone: string;
  fonte: string | null;
  segmento: string | null;
  endereco: string | null;
  whatsappConfirmado: false;
  consentimento: "nao_coletado";
}

export interface JanelaDaLista {
  inicio: string;
  fim: string;
  fuso: string;
}

export type DecisaoDaJanela =
  | { tipo: "sem_janela" }
  | { tipo: "dentro" }
  | { tipo: "esperar"; enviarEm: Date }
  | { tipo: "encerrada" };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rascunho de instrução da KD. Não publica agente e não entra sozinho
 * numa campanha: quem monta o rascunho escolhe passá-lo no campo de texto.
 */
export const RASCUNHO_INSTRUCAO_KD = [
  "A casa produz sob encomenda. Não diga que vai separar do estoque.",
  "Com logo, o prazo é de até 7 dias. Sem logo, até 3 dias.",
  "Preço de peça com logo fica com o Jeferson. Não invente esse preço.",
  "Só trate como pedido quando a pessoa aceitar com clareza. Menu automático não é pedido.",
  "Depois do aceite, peça endereço, bairro, nome de quem recebe e horário.",
  "Se disserem que estão fechados e a que horas voltam, anote o horário. Não envie de novo e não marque retorno sozinho.",
  "Não apague o que a pessoa já informou.",
].join(" ");

/** Celular brasileiro em E.164. Fixo e número sem o 9 do celular não passam. */
export function celularBrasileiro(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const nacional = digits.startsWith("55") ? digits.slice(2) : digits;
  if (!/^\d{2}9\d{8}$/.test(nacional)) return null;
  return `+55${nacional}`;
}

export function prepararLista(empresas: readonly EmpresaDaLista[]): CandidatoDaLista[] {
  if (empresas.length < 1 || empresas.length > LIMITE_DA_LISTA) {
    throw new Error("A lista precisa ter de 1 a 100 empresas.");
  }
  const vistos = new Set<string>();
  return empresas.map((empresa, indice) => {
    const nome = empresa.nome.trim();
    if (nome.length < 2) throw new Error(`Nome curto na linha ${indice + 1}.`);
    const telefone = celularBrasileiro(empresa.telefone);
    if (!telefone) throw new Error(`Celular inválido na linha ${indice + 1}.`);
    if (vistos.has(telefone)) throw new Error(`Celular repetido na lista: ${telefone}.`);
    vistos.add(telefone);
    return {
      placeId: `lista:${createHash("sha256").update(telefone).digest("hex").slice(0, 24)}`,
      nome: nome.slice(0, 200),
      telefone,
      fonte: empresa.fonte?.trim() || null,
      segmento: empresa.segmento?.trim() || null,
      endereco: empresa.endereco?.trim() || null,
      whatsappConfirmado: false,
      consentimento: "nao_coletado",
    };
  });
}

export function lerJanela(valor: unknown): JanelaDaLista | null {
  if (!valor || typeof valor !== "object") return null;
  const j = valor as { janela?: unknown };
  const janela = (j.janela ?? valor) as { inicio?: unknown; fim?: unknown; fuso?: unknown };
  if (typeof janela.inicio !== "string" || typeof janela.fim !== "string") return null;
  if (!DIA.test(janela.inicio) || !DIA.test(janela.fim) || janela.fim < janela.inicio) return null;
  return {
    inicio: janela.inicio,
    fim: janela.fim,
    fuso: typeof janela.fuso === "string" && janela.fuso.length > 0 ? janela.fuso : FUSO_DA_LISTA,
  };
}

function diaNoFuso(quando: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(quando);
}

/** 09:00 no fuso da lista, em UTC. America/Manaus não tem horário de verão. */
export function instanteNoFuso(dia: string, hora: string, fuso: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  const chute = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(chute));
  const ler = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  const horaLocal = ler("hour") % 24;
  const visto = Date.UTC(ler("year"), ler("month") - 1, ler("day"), horaLocal, ler("minute"), ler("second"));
  return new Date(chute - (visto - chute));
}

/**
 * Antes do primeiro dia, espera. Dentro, segue. Depois do último, para.
 * Sem janela no registro, não muda o ritmo que a campanha já tinha.
 */
export function decisaoDaJanela(search: unknown, agora: Date): DecisaoDaJanela {
  const bruto = search && typeof search === "object" ? (search as { janela?: unknown }).janela : null;
  const janela = lerJanela(bruto ? { janela: bruto } : null);
  if (!janela) return { tipo: "sem_janela" };
  const hoje = diaNoFuso(agora, janela.fuso);
  if (hoje < janela.inicio) return { tipo: "esperar", enviarEm: instanteNoFuso(janela.inicio, "09:00", janela.fuso) };
  if (hoje > janela.fim) return { tipo: "encerrada" };
  return { tipo: "dentro" };
}
