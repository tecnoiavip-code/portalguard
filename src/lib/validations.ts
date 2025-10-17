import { z } from 'zod';

// Validação de CPF
export const validateCPF = (cpf: string): boolean => {
  cpf = cpf.replace(/[^\d]/g, '');
  
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cpf.charAt(9))) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf.charAt(i)) * (11 - i);
  }
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cpf.charAt(10))) return false;

  return true;
};

// Validação de Placa de Veículo (Padrão Mercosul)
export const validateVehiclePlate = (plate: string): boolean => {
  const mercosulPattern = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
  const oldPattern = /^[A-Z]{3}[0-9]{4}$/;
  
  const cleanPlate = plate.replace(/[^A-Z0-9]/g, '').toUpperCase();
  return mercosulPattern.test(cleanPlate) || oldPattern.test(cleanPlate);
};

// Schema de validação para Morador
export const residentSchema = z.object({
  name: z.string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres')
    .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Nome deve conter apenas letras'),
  cpf: z.string()
    .refine(validateCPF, 'CPF inválido'),
  apartment: z.string()
    .min(1, 'Apartamento é obrigatório')
    .max(20, 'Apartamento deve ter no máximo 20 caracteres'),
  phone: z.string()
    .min(10, 'Telefone deve ter no mínimo 10 dígitos')
    .max(15, 'Telefone deve ter no máximo 15 dígitos')
    .regex(/^[0-9\s\-\(\)]+$/, 'Formato de telefone inválido'),
  email: z.string()
    .email('Email inválido')
    .max(100, 'Email deve ter no máximo 100 caracteres'),
  vehiclePlate: z.string()
    .optional()
    .refine((plate) => !plate || validateVehiclePlate(plate), 'Placa inválida'),
  vehicleModel: z.string()
    .max(50, 'Modelo deve ter no máximo 50 caracteres')
    .optional(),
  vehicleColor: z.string()
    .max(30, 'Cor deve ter no máximo 30 caracteres')
    .optional(),
});

// Schema de validação para Visitante/Prestador
export const visitorSchema = z.object({
  visitorName: z.string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres')
    .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Nome deve conter apenas letras'),
  visitorDocument: z.string()
    .min(5, 'Documento deve ter no mínimo 5 caracteres')
    .max(20, 'Documento deve ter no máximo 20 caracteres')
    .regex(/^[0-9]+$/, 'Documento deve conter apenas números'),
  purpose: z.string()
    .min(3, 'Motivo deve ter no mínimo 3 caracteres')
    .max(200, 'Motivo deve ter no máximo 200 caracteres'),
  company: z.string()
    .max(100, 'Empresa deve ter no máximo 100 caracteres')
    .optional(),
  vehiclePlate: z.string()
    .optional()
    .refine((plate) => !plate || validateVehiclePlate(plate), 'Placa inválida'),
});

// Schema de validação para Correspondência
export const mailSchema = z.object({
  sender: z.string()
    .min(3, 'Remetente deve ter no mínimo 3 caracteres')
    .max(100, 'Remetente deve ter no máximo 100 caracteres'),
  notes: z.string()
    .max(500, 'Observações devem ter no máximo 500 caracteres')
    .optional(),
});

// Função auxiliar para formatar erros do Zod
export const formatZodErrors = (error: z.ZodError): string => {
  return error.errors.map(err => err.message).join(', ');
};
