
"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Pregunta = {
  id: number;
  numero: number;
  codigo: string;
  enunciado: string;
  alternativa_a: string;
  alternativa_b: string;
  alternativa_c: string;
  alternativa_d: string;
  orden: number;
};

type Participante = {
  id: string;
  nombre: string;
  estado: "EN_PROGRESO" | "FINALIZADO";
  pregunta_actual: number;
  puntaje: number | null;
  fecha_inicio: string;
  fecha_limite: string;
  fecha_finalizacion?: string | null;
};

type Respuestas = Record<string, string>;

type DetalleResultado = {
  numero: number;
  codigo: string;
  pregunta: string;
  respuesta_marcada: string | null;
  alternativa_marcada: string | null;
  respuesta_correcta: string | null;
  alternativa_correcta: string | null;
  es_correcta: boolean;
};

type Resultado = {
  nombre: string;
  estado: string;
  puntaje: number;
  fecha_inicio: string;
  fecha_finalizacion: string;
  fecha_limite: string;
  detalle: DetalleResultado[];
};

const DURACION_SEGUNDOS = 50 * 60;

function obtenerMensajeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado. Intenta nuevamente.";
}

function formatoTiempo(segundos: number) {
  const seguros = Math.max(0, segundos);
  const minutos = Math.floor(seguros / 60);
  const resto = seguros % 60;
  return `${String(minutos).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

export default function Home() {
  const [pantalla, setPantalla] = useState<
  "cargando" | "inicio" | "examen" | "resultado"
>("inicio");

  const [nombre, setNombre] = useState("");
  const [participante, setParticipante] = useState<Participante | null>(null);
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [respuestas, setRespuestas] = useState<Respuestas>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState("");
  const [iniciando, setIniciando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [preguntasFaltantes, setPreguntasFaltantes] = useState<number | null>(null);
  const [estadoGuardado, setEstadoGuardado] = useState(
    "El avance se guarda automáticamente."
  );
  const [segundosRestantes, setSegundosRestantes] = useState(DURACION_SEGUNDOS);

  const respuestasRef = useRef<Respuestas>({});
  const participanteRef = useRef<Participante | null>(null);
  const finalizandoRef = useRef(false);

  useEffect(() => {
    respuestasRef.current = respuestas;
  }, [respuestas]);

  useEffect(() => {
    participanteRef.current = participante;
  }, [participante]);

  const mostrarResultado = useCallback(async (participanteId: string) => {
    const { data, error: resultadoError } = await supabase.rpc(
      "iglesia2_resultado",
      { p_participante_id: participanteId }
    );

    if (resultadoError) throw resultadoError;

    const dato = data as Resultado;
    setResultado(dato);
    setPantalla("resultado");
    setConfirmandoEnvio(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const finalizarExamen = useCallback(
    async (porTiempo = false) => {
      const actual = participanteRef.current;
      if (!actual || finalizandoRef.current) return;

      finalizandoRef.current = true;
      setFinalizando(true);
      setConfirmandoEnvio(false);
      setEstadoGuardado(
        porTiempo ? "El tiempo terminó. Finalizando examen…" : "Finalizando examen…"
      );
      setError("");

      try {
        if (!porTiempo) {
  // Al entregar manualmente, sincronizar las respuestas pendientes.
  const respuestasActuales = respuestasRef.current;

  for (const pregunta of preguntas) {
    const respuesta = respuestasActuales[pregunta.codigo];
    if (!respuesta) continue;

    const { error: guardarError } = await supabase.rpc(
      "iglesia2_guardar_respuesta",
      {
        p_participante_id: actual.id,
        p_codigo: pregunta.codigo,
        p_respuesta: respuesta,
        p_pregunta_actual: pregunta.numero,
      }
    );

    if (guardarError) {
      throw guardarError;
    }
  }
}

        const { error: finalizarError } = await supabase.rpc(
          "iglesia2_finalizar",
          {
            p_participante_id: actual.id,
            p_por_tiempo: porTiempo,
          }
        );

        // La función puede informar que ya estaba finalizado; en ese caso
        // consultamos el resultado definitivo del servidor.
        if (finalizarError) throw finalizarError;

        setParticipante({ ...actual, estado: "FINALIZADO" });
        await mostrarResultado(actual.id);
      } catch (e) {
        setError(
          `No se pudo completar la finalización: ${obtenerMensajeError(e)}`
        );
        setEstadoGuardado("No se pudo confirmar el envío.");
      } finally {
        finalizandoRef.current = false;
        setFinalizando(false);
      }
    },
    [preguntas, mostrarResultado]
  );

  useEffect(() => {
    if (pantalla !== "examen" || !participante) return;

    const actualizarTiempo = () => {
      const restante = Math.max(
        0,
        Math.ceil(
          (new Date(participante.fecha_limite).getTime() - Date.now()) / 1000
        )
      );

      setSegundosRestantes(restante);

      if (restante <= 0 && !finalizandoRef.current) {
        void finalizarExamen(true);
      }
    };

    actualizarTiempo();
    const temporizador = window.setInterval(actualizarTiempo, 1000);

    return () => window.clearInterval(temporizador);
  }, [pantalla, participante, finalizarExamen]);

  async function iniciarExamen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (nombre.trim().length < 3) {
      setError("Ingresa tus nombres y apellidos completos.");
      return;
    }

    setIniciando(true);

    try {
      const { data: participanteData, error: participanteError } =
        await supabase.rpc("iglesia2_iniciar_o_reanudar", {
          p_nombre: nombre.trim(),
        });

      if (participanteError) throw participanteError;

      const p = participanteData as Participante;

      if (!p?.id) {
        throw new Error("Supabase no devolvió los datos del participante.");
      }

      if (p.estado === "FINALIZADO") {
        setParticipante(p);
        await mostrarResultado(p.id);
        return;
      }

      const [
        { data: preguntasData, error: preguntasError },
        { data: respuestasData, error: respuestasError },
      ] = await Promise.all([
        supabase
          .from("iglesia2_preguntas_publicas")
          .select(
            "id, numero, codigo, enunciado, alternativa_a, alternativa_b, alternativa_c, alternativa_d, orden"
          )
          .order("orden", { ascending: true }),
        supabase.rpc("iglesia2_obtener_respuestas", {
          p_participante_id: p.id,
        }),
      ]);

      if (preguntasError) throw preguntasError;
      if (respuestasError) throw respuestasError;

      const lista = (preguntasData ?? []) as Pregunta[];
      if (lista.length === 0) {
        throw new Error("No hay preguntas activas cargadas en Supabase.");
      }

      const guardadas = (respuestasData ?? {}) as Respuestas;

      setParticipante(p);
      participanteRef.current = p;
      setPreguntas(lista);
      setRespuestas(guardadas);
      respuestasRef.current = guardadas;
      setSegundosRestantes(
        Math.max(
          0,
          Math.ceil((new Date(p.fecha_limite).getTime() - Date.now()) / 1000)
        )
      );
      setPantalla("examen");
      setEstadoGuardado("Respuestas sincronizadas con Supabase.");
    } catch (e) {
      setError(obtenerMensajeError(e));
    } finally {
      setIniciando(false);
    }
  }

  async function seleccionarRespuesta(codigo: string, respuesta: string) {
    const actual = participanteRef.current;
    if (!actual || actual.estado !== "EN_PROGRESO" || finalizandoRef.current) {
      return;
    }

    const pregunta = preguntas.find((item) => item.codigo === codigo);
    if (!pregunta) return;

    const nuevasRespuestas = {
      ...respuestasRef.current,
      [codigo]: respuesta,
    };

    respuestasRef.current = nuevasRespuestas;
    setRespuestas(nuevasRespuestas);
    setPreguntasFaltantes(null);
    setEstadoGuardado(`Guardando respuesta ${pregunta.numero}…`);

    try {
      const { error: guardarError } = await supabase.rpc(
        "iglesia2_guardar_respuesta",
        {
          p_participante_id: actual.id,
          p_codigo: codigo,
          p_respuesta: respuesta,
          p_pregunta_actual: pregunta.numero,
        }
      );

      if (guardarError) throw guardarError;

      setEstadoGuardado("Avance guardado automáticamente.");
    } catch (e) {
      setEstadoGuardado("No se pudo guardar en el servidor.");
      setError(
        `La respuesta quedó seleccionada en pantalla, pero no se confirmó su guardado: ${obtenerMensajeError(e)}`
      );
    }
  }

  function enviarExamen() {
    if (!participante || finalizandoRef.current) return;

    const faltantes = preguntas.filter(
      (pregunta) => !respuestasRef.current[pregunta.codigo]
    );

    if (faltantes.length > 0) {
      setPreguntasFaltantes(faltantes.length);
      setError(
        `Te falta${faltantes.length === 1 ? "" : "n"} responder ${faltantes.length} pregunta${faltantes.length === 1 ? "" : "s"}. Puedes regresar a completarlas o enviar el examen sin responderlas.`
      );
      return;
    }

    setPreguntasFaltantes(0);
    setError("");
    setConfirmandoEnvio(true);
  }

  const respondidas = preguntas.filter(
    (pregunta) => Boolean(respuestas[pregunta.codigo])
  ).length;

  const progreso = preguntas.length
    ? (respondidas / preguntas.length) * 100
    : 0;

  if (pantalla === "cargando") {
    return (
      <>
        <div className="topbar" />
        <main className="container">
          <section className="card loader">Cargando el examen…</section>
        </main>
      </>
    );
  }

  if (pantalla === "resultado" && resultado) {
    const correctas = resultado.detalle.filter((item) => item.es_correcta).length;

    return (
      <>
        <div className="topbar" />
        <main className="container">
          <section className="card hero score-panel">
            <h1>Resultado del examen</h1>
            <p className="muted">{resultado.nombre}</p>
            <div className="score">{Number(resultado.puntaje ?? 0).toFixed(2)}/20</div>
            <p>
              <strong>{correctas}</strong> de{" "}
              <strong>{resultado.detalle.length}</strong> respuestas correctas
            </p>
            <span
              className={`outcome ${
                Number(resultado.puntaje ?? 0) >= 11 ? "pass" : "fail"
              }`}
            >
              {Number(resultado.puntaje ?? 0) >= 11 ? "APROBADO" : "DESAPROBADO"}
            </span>
            <p className="muted">
              El examen ha sido finalizado y no se pueden modificar las respuestas.
            </p>
          </section>

          <section className="card">
            <h2>Comparación de respuestas</h2>
            <p className="muted">
              Revisa la alternativa que marcaste y la respuesta correcta.
            </p>
          </section>

          {resultado.detalle.map((item, index) => (
            <article
              key={item.codigo}
              className={`card review ${item.es_correcta ? "correct" : "incorrect"}`}
            >
              <div className="question-number">Pregunta {index + 1}</div>
              <div className="question-text">{item.pregunta}</div>

              <div className={`answer-box ${item.es_correcta ? "correct" : "incorrect"}`}>
                Tu respuesta:{" "}
                <strong>
                  {item.respuesta_marcada
                    ? `${item.respuesta_marcada}${item.respuesta_marcada === item.respuesta_correcta ? ". " + item.alternativa_correcta : ""}`
                    : "Sin responder"}
                </strong>
              </div>

              {!item.es_correcta && (
                <div className="answer-box correct">
                  Respuesta correcta:{" "}
                  <strong>
                    {item.respuesta_correcta}. {item.alternativa_correcta}
                  </strong>
                </div>
              )}
            </article>
          ))}
        </main>
      </>
    );
  }

  return (
    <>
      <div className="topbar" />
      <main className="container">
        {pantalla === "inicio" && (
          <>
            <section className="card hero">
              <h1>Examen II: La Iglesia</h1>
              <p className="muted">
                Evaluación del discipulado · 20 preguntas · Nota sobre 20
              </p>
              <p>
                Lee cada pregunta con atención y selecciona una alternativa.
                El examen dispone de 50 minutos. Tus respuestas se guardan
                automáticamente.
              </p>
              <p className="muted">
                <span className="required">*</span> Ingresa tus nombres y apellidos
                completos. Utiliza el mismo nombre para reanudar un examen iniciado.
              </p>
            </section>

            <section className="card">
              <form onSubmit={iniciarExamen}>
                <label className="field-label" htmlFor="nombre">
                  Nombres y apellidos completos <span className="required">*</span>
                </label>
                <input
                  id="nombre"
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  placeholder="Ejemplo: Juan Pérez López"
                  value={nombre}
                  onChange={(event) => setNombre(event.target.value)}
                  required
                />
                <div className="actions">
                  <span className="save-status">
                    Examen independiente: La Iglesia
                  </span>
                  <button className="primary" type="submit" disabled={iniciando}>
                    {iniciando ? "Ingresando…" : "Comenzar o continuar"}
                  </button>
                </div>
                {error && <p className="error-message required">{error}</p>}
              </form>
            </section>
          </>
        )}

        {pantalla === "examen" && participante && (
          <>
            <section className="card hero">
              <h1>Examen II: La Iglesia</h1>
              <span className="participant-chip">{participante.nombre}</span>
              <div className="timer-panel">
                <span>Tiempo restante</span>
                <strong className={segundosRestantes <= 300 ? "timer-warning" : ""}>
                  {formatoTiempo(segundosRestantes)}
                </strong>
              </div>
            </section>

            <div className="progress-shell">
              <div className="progress-row">
                <span>Progreso</span>
                <span>
                  {respondidas} de {preguntas.length} respondidas
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${progreso}%` }} />
              </div>
            </div>

            {preguntas.map((pregunta, index) => {
              const alternativas = [
                { letra: "A", texto: pregunta.alternativa_a },
                { letra: "B", texto: pregunta.alternativa_b },
                { letra: "C", texto: pregunta.alternativa_c },
                { letra: "D", texto: pregunta.alternativa_d },
              ];

              return (
                <article
                  className="card"
                  id={`question-${pregunta.codigo}`}
                  key={pregunta.codigo}
                >
                  <div className="question-number">
                    Pregunta {index + 1} de {preguntas.length}
                  </div>
                  <div className="question-text">
                    {pregunta.enunciado} <span className="required">*</span>
                  </div>

                  <div className="options-list">
                    {alternativas.map((alternativa) => (
                      <label
                        className={`option ${
                          respuestas[pregunta.codigo] === alternativa.letra
                            ? "selected"
                            : ""
                        }`}
                        key={alternativa.letra}
                      >
                        <input
                          type="radio"
                          name={`pregunta-${pregunta.codigo}`}
                          value={alternativa.letra}
                          checked={respuestas[pregunta.codigo] === alternativa.letra}
                          onChange={() =>
                            void seleccionarRespuesta(pregunta.codigo, alternativa.letra)
                          }
                          disabled={finalizando || segundosRestantes <= 0}
                        />
                        <span className="option-letter">{alternativa.letra}.</span>
                        <span>{alternativa.texto}</span>
                      </label>
                    ))}
                  </div>
                </article>
              );
            })}

            {error && <p className="error-message required">{error}</p>}

            {confirmandoEnvio ? (
              <div className="confirmation-box">
                <div>
                  <strong>¿Estás seguro de enviar el examen?</strong>
                  <p className="save-status">
                    Después de finalizar no podrás cambiar tus respuestas.
                  </p>
                </div>
                <div className="confirmation-actions">
                  <button
                    type="button"
                    onClick={() => setConfirmandoEnvio(false)}
                    disabled={finalizando}
                  >
                    No, volver
                  </button>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => void finalizarExamen(false)}
                    disabled={finalizando}
                  >
                    {finalizando ? "Calificando…" : "Sí, enviar examen"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <span className="save-status">
                  {preguntasFaltantes !== null && preguntasFaltantes > 0
                    ? `Faltan responder ${preguntasFaltantes} pregunta(s).`
                    : estadoGuardado}
                </span>
                <button
                  className="primary"
                  type="button"
                  onClick={enviarExamen}
                  disabled={finalizando || segundosRestantes <= 0}
                >
                  Enviar examen
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
