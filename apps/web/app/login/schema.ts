import { z } from "zod";

export const LoginSchema = z.object({
  email: z.email("Escribe un correo válido"),
  password: z.string().min(1, "Escribe tu contraseña"),
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
