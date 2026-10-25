
"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/lib/supabase";

type Resultado = {
  participante_id: string;
  nombre: string;
  nota: number;
  porcentaje: number;
  estado: string;
  fecha_finalizacion: string | null;
};

type RespuestaAlumno = {
  numero: number;
  pregunta: string;
  respuesta_marcada: string | null;
  alternativa_marcada: string | null;
  respuesta_correcta: string | null;
  alternativa_correcta: string | null;
  es_correcta: boolean;
};

type RespuestaExcel = {
  participante_id: string;
  nombre: string;
  nota: number;
  fecha_finalizacion: string | null;
  numero: number;
  pregunta: string;
  respuesta_marcada: string | null;
  respuesta_correcta: string | null;
  es_correcta: boolean;
};

export default function NotasIglesia2Page() {
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [alumnoSeleccionado, setAlumnoSeleccionado] =
    useState<Resultado | null>(null);
  const [respuestasAlumno, setRespuestasAlumno] =
    useState<RespuestaAlumno[]>([]);
  const [cargandoRespuestas, setCargandoRespuestas] = useState(false);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    void cargarResultados();
  }, []);

  async function cargarResultados() {
    setCargando(true);
    setError("");

    const { data, error } = await supabase.rpc(
      "iglesia2_obtener_resultados_profesores"
    );

    if (error) {
      setError(error.message);
      setCargando(false);
      return;
    }

    setResultados((data ?? []) as Resultado[]);
    setCargando(false);
  }

  const resultadosFiltrados = resultados.filter((resultado) =>
    resultado.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  function formatearFecha(fecha: string | null) {
    if (!fecha) return "—";

    return new Date(fecha).toLocaleString("es-PE", {
      timeZone: "America/Lima",
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  async function verRespuestas(alumno: Resultado) {
    setAlumnoSeleccionado(alumno);
    setCargandoRespuestas(true);
    setRespuestasAlumno([]);
    setError("");

    const { data, error } = await supabase.rpc(
      "iglesia2_obtener_respuestas_profesor",
      { p_participante_id: alumno.participante_id }
    );

    if (error) {
      setError(error.message);
      setCargandoRespuestas(false);
      return;
    }

    setRespuestasAlumno((data ?? []) as RespuestaAlumno[]);
    setCargandoRespuestas(false);
  }

  async function descargarExcel() {
    setError("");
    setDescargando(true);

    try {
      const tamanoPagina = 1000;
      let desde = 0;
      const todasLasRespuestas: RespuestaExcel[] = [];

      while (true) {
        const { data, error } = await supabase
          .rpc("iglesia2_obtener_todas_respuestas_profesor")
          .range(desde, desde + tamanoPagina - 1);

        if (error) throw error;

        const pagina = (data ?? []) as RespuestaExcel[];

        if (pagina.length === 0) break;

        todasLasRespuestas.push(...pagina);

        if (pagina.length < tamanoPagina) break;

        desde += tamanoPagina;
      }

      if (todasLasRespuestas.length === 0) {
        setError("Todavía no hay respuestas para exportar.");
        return;
      }

      const preguntas = Array.from(
        new Map(
          todasLasRespuestas.map((r) => [
            r.numero,
            { numero: r.numero, pregunta: r.pregunta },
          ])
        ).values()
      ).sort((a, b) => a.numero - b.numero);

      const alumnos = Array.from(
        new Map(
          todasLasRespuestas.map((r) => [
            r.participante_id,
            {
              participante_id: r.participante_id,
              nombre: r.nombre,
              nota: r.nota,
              fecha_finalizacion: r.fecha_finalizacion,
            },
          ])
        ).values()
      );

      const respuestasPorAlumno = new Map<
        string,
        Map<number, RespuestaExcel>
      >();

      for (const respuesta of todasLasRespuestas) {
        if (!respuestasPorAlumno.has(respuesta.participante_id)) {
          respuestasPorAlumno.set(
            respuesta.participante_id,
            new Map()
          );
        }

        respuestasPorAlumno
          .get(respuesta.participante_id)!
          .set(respuesta.numero, respuesta);
      }

      const encabezados = [
        ...preguntas.map(
          (p) => `${p.numero}. ${p.pregunta}`
        ),
        "Puntuación",
        "Nombres y Apellidos",
        "Fecha de finalización",
      ];

      const filas = alumnos.map((alumno) => {
        const respuestas =
          respuestasPorAlumno.get(alumno.participante_id);

        return [
          ...preguntas.map(
            (pregunta) =>
              respuestas?.get(pregunta.numero)?.respuesta_marcada ?? ""
          ),
          alumno.nota,
          alumno.nombre,
          formatearFecha(alumno.fecha_finalizacion),
        ];
      });

      const hoja = XLSX.utils.aoa_to_sheet([
        encabezados,
        ...filas,
      ]);

      hoja["!cols"] = [
        ...preguntas.map(() => ({ wch: 35 })),
        { wch: 14 },
        { wch: 30 },
        { wch: 22 },
      ];

      hoja["!rows"] = [
        { hpt: 90 },
        ...filas.map(() => ({ hpt: 25 })),
      ];

      const rango = XLSX.utils.decode_range(hoja["!ref"]!);

      for (let fila = rango.s.r; fila <= rango.e.r; fila++) {
        for (
          let columna = rango.s.c;
          columna <= rango.e.c;
          columna++
        ) {
          const direccion = XLSX.utils.encode_cell({
            r: fila,
            c: columna,
          });

          const celda = hoja[direccion];
          if (!celda) continue;

          celda.s = {
            font: {
              name: "Arial",
              sz: 10,
              bold: fila === 0,
              color: {
                rgb: fila === 0 ? "FFFFFF" : "222222",
              },
            },
            fill: {
              fgColor: {
                rgb:
                  fila === 0
                    ? "5E35B1"
                    : fila % 2 === 0
                      ? "F4F1FB"
                      : "FFFFFF",
              },
            },
            alignment: {
              vertical: "center",
              horizontal: fila === 0 ? "center" : "left",
              wrapText: true,
            },
            border: {
              top: { style: "thin", color: { rgb: "D9D9E3" } },
              bottom: { style: "thin", color: { rgb: "D9D9E3" } },
              left: { style: "thin", color: { rgb: "D9D9E3" } },
              right: { style: "thin", color: { rgb: "D9D9E3" } },
            },
          };
        }
      }

      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Examen Iglesia II");

      XLSX.writeFile(libro, "resultados_examen_iglesia2.xlsx");
    } catch (e) {
      console.error("Error exportando resultados:", e);
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo generar el archivo Excel."
      );
    } finally {
      setDescargando(false);
    }
  }

  return (
    <main className="container">
      <section className="card hero">
        <h1>Resultados del discipulado — Examen II</h1>
        <p className="muted">
          Consulta las notas y respuestas del segundo examen,
          independientemente del examen original.
        </p>
      </section>

      <section className="card">
        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={descargarExcel}
            disabled={descargando || resultados.length === 0}
          >
            {descargando ? "Generando Excel..." : "Descargar Excel"}
          </button>

          <button type="button" onClick={cargarResultados}>
            Actualizar resultados
          </button>
        </div>
      </section>

      <section className="card">
        {cargando && <p>Cargando resultados...</p>}

        {error && <p className="required">{error}</p>}

        {!cargando && resultados.length === 0 && !error && (
          <p className="muted">
            Todavía no hay participantes que hayan finalizado el examen.
          </p>
        )}

        <div className="search-box">
          <label htmlFor="buscar-alumno-iglesia2">
            Buscar alumno
          </label>
          <input
            id="buscar-alumno-iglesia2"
            type="search"
            placeholder="Escribe el nombre del alumno..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        {!cargando && resultados.length > 0 && (
          <div className="table-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th>N.°</th>
                  <th>Participante</th>
                  <th>Nota</th>
                  <th>Porcentaje</th>
                  <th>Estado</th>
                  <th>Fecha de finalización</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {resultadosFiltrados.map((resultado, index) => (
                  <tr key={resultado.participante_id}>
                    <td>{index + 1}</td>
                    <td>{resultado.nombre}</td>
                    <td>{Number(resultado.nota).toFixed(1)}</td>
                    <td>{Number(resultado.porcentaje).toFixed(1)}%</td>
                    <td>
                      <span
                        className={
                          resultado.estado === "APROBADO"
                            ? "status-approved"
                            : "status-failed"
                        }
                      >
                        {resultado.estado}
                      </span>
                    </td>
                    <td>
                      {formatearFecha(resultado.fecha_finalizacion)}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void verRespuestas(resultado)}
                      >
                        Ver respuestas
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {alumnoSeleccionado && (
          <div className="answer-review">
            <div className="answer-review-header">
              <h2>
                Respuestas de {alumnoSeleccionado.nombre}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setAlumnoSeleccionado(null);
                  setRespuestasAlumno([]);
                }}
              >
                Cerrar
              </button>
            </div>

            {cargandoRespuestas && <p>Cargando respuestas...</p>}

            {!cargandoRespuestas &&
              respuestasAlumno.map((respuesta) => (
                <article
                  key={respuesta.numero}
                  className={
                    respuesta.es_correcta
                      ? "answer-correct"
                      : "answer-incorrect"
                  }
                >
                  <strong>Pregunta {respuesta.numero}</strong>
                  <p>{respuesta.pregunta}</p>

                  <p>
                    Respuesta marcada:{" "}
                    <strong>
                      {respuesta.respuesta_marcada
                        ? `${respuesta.respuesta_marcada}. ${
                            respuesta.alternativa_marcada ?? ""
                          }`
                        : "Sin responder"}
                    </strong>
                  </p>

                  <p>
                    Respuesta correcta:{" "}
                    <strong>
                      {respuesta.respuesta_correcta
                        ? `${respuesta.respuesta_correcta}. ${
                            respuesta.alternativa_correcta ?? ""
                          }`
                        : "No disponible"}
                    </strong>
                  </p>

                  <p>
                    Resultado:{" "}
                    {respuesta.es_correcta ? "Correcta" : "Incorrecta"}
                  </p>
                </article>
              ))}
          </div>
        )}
      </section>
    </main>
  );
}