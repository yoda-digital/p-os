import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateCaseInput } from '../lib/api';

export function useCases() {
  return useQuery({ queryKey: ['cases'], queryFn: api.listCases });
}

export function useCase(id: string | undefined) {
  return useQuery({
    queryKey: ['case', id],
    queryFn: () => api.getCase(id!),
    enabled: !!id,
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCaseInput) => api.createCase(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  });
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateCaseInput> }) => api.updateCase(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['case', id] });
    },
  });
}

export function useCloseCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeCase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  });
}

export function useDeleteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  });
}
