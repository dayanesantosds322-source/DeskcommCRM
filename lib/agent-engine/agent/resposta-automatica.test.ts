/**
 * A entrada que parece resposta automática não vira resposta, pedido nem passagem.
 *
 * O turno já impedia o handoff determinístico de um menu (`ehRespostaDeRobo`)
 * e em seguida chamava o modelo. O modelo respondia o menu, tratava a lista
 * como pedido e reagia a aviso de expediente e a emoji. Esta decisão é a
 * parada anterior: esperar uma pessoa, sem envio e sem agenda.
 *
 * Pessoa com endereço, link ou horário combinado continua. Aceite claro
 * ("quero") continua. Pedido de gente fora de um menu continua nas mãos da
 * guarda que já existia — aqui ele só não pode ser classificado como espera.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectHumanHandoffRequest } from "@/lib/agent-engine/agent/human-handoff";
import {
  algumaEntradaEspera,
  decidirEsperaPorHumano,
  horarioAnunciado,
  type MensagemParaEspera,
} from "@/lib/agent-engine/agent/resposta-automatica";

const MENU = [
  "Olá! Escolha uma opção:",
  "1 - Ver o cardápio",
  "2 - Fazer um pedido",
  "3 - Falar com um atendente",
  "Digite o número da opção desejada.",
].join("\n");

const FECHADO = "No momento estamos fechados. Retornamos às 17:30.";

function historicoCom(texto: string, vezes = 1): MensagemParaEspera[] {
  const itens: MensagemParaEspera[] = [
    { direction: "outbound", body: "Boa tarde! Posso anotar o pedido?" },
  ];
  for (let i = 0; i < vezes; i += 1) itens.push({ direction: "inbound", body: texto });
  return itens;
}

describe("decidirEsperaPorHumano", () => {
  it("menu numerado espera e não é tratado como pedido", () => {
    const decisao = decidirEsperaPorHumano(MENU, historicoCom(MENU));
    expect(decisao.esperar).toBe(true);
    expect(decisao.motivo).toBe("menu");
    expect(decisao.sugerirRetomadaUnica).toBe(false);
  });

  it("pedido de gente fora de menu não é espera", () => {
    const texto = "quero falar com um atendente";
    expect(detectHumanHandoffRequest(texto)).toBe(true);
    expect(decidirEsperaPorHumano(texto).esperar).toBe(false);
  });

  it("expediente fechado espera, guarda o relógio e sugere retomada uma vez", () => {
    const primeira = decidirEsperaPorHumano(FECHADO, historicoCom(FECHADO, 1));
    expect(primeira).toMatchObject({
      esperar: true,
      motivo: "expediente",
      horarioAnunciado: "17:30",
      sugerirRetomadaUnica: true,
    });
    const repetida = decidirEsperaPorHumano(FECHADO, historicoCom(FECHADO, 2));
    expect(repetida.esperar).toBe(true);
    expect(repetida.sugerirRetomadaUnica).toBe(false);
  });

  it("endereço, link e horário combinado por uma pessoa seguem", () => {
    expect(
      decidirEsperaPorHumano(
        "Rua das Flores, 120, bairro Centro, recebedor Maria, pode ser às 17:30",
      ).esperar,
    ).toBe(false);
    expect(decidirEsperaPorHumano("segue o ponto https://maps.example/pin").esperar).toBe(false);
    expect(decidirEsperaPorHumano("pode entregar às 17h30").esperar).toBe(false);
    expect(decidirEsperaPorHumano("meu horário é 18h").esperar).toBe(false);
  });

  it("aceite claro segue; lista com instrução de menu não", () => {
    expect(decidirEsperaPorHumano("quero 2 frangos sem logo").esperar).toBe(false);
    expect(decidirEsperaPorHumano("pode mandar o de sempre").esperar).toBe(false);
    const cardapio = "1 - Frango\n2 - Peixe\nDigite o número da opção desejada. Quero ajudar.";
    expect(decidirEsperaPorHumano(cardapio).motivo).toBe("menu");
  });

  it("autodeclaração espera; reclamação do nosso robô segue", () => {
    expect(decidirEsperaPorHumano("Olá, sou o assistente virtual da casa.").motivo).toBe(
      "autodeclaracao",
    );
    expect(decidirEsperaPorHumano("esse assistente virtual não resolve nada").esperar).toBe(false);
  });

  it("só emoji espera, e a mesma frase sem informação nova também", () => {
    expect(decidirEsperaPorHumano("👍😊").motivo).toBe("emoji");
    const texto = "posso te enviar o cardápio completo agora";
    expect(decidirEsperaPorHumano(texto, historicoCom(texto, 1)).esperar).toBe(false);
    expect(decidirEsperaPorHumano(texto, historicoCom(texto, 2)).motivo).toBe("repetida");
  });

  it("relógio ilegível não vira hora", () => {
    expect(horarioAnunciado("retornamos as 27:30")).toBe(null);
    expect(horarioAnunciado("retornamos as 9h")).toBe("09:00");
  });

  it("a primeira pendência que espera segura o turno", () => {
    const achada = algumaEntradaEspera(["quero 2", MENU], []);
    expect(achada?.motivo).toBe("menu");
    expect(algumaEntradaEspera(["quero 2", "pode mandar"], [])).toBe(null);
  });
});

describe("ligação no turno", () => {
  const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");

  it("a espera é consultada no comercial, no assistido e no automático", () => {
    expect(fonte.match(/algumaEntradaEspera\(/g)?.length).toBe(3);
  });
});
