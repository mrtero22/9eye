import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { currentCompany, setCurrentCompany } from '@/lib/api';

/** Switch to another company of the signed-in person and open a page there. */
export function useSwitchCompany() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (slug: string, to = '/templates') => {
    if (slug !== currentCompany()) {
      setCurrentCompany(slug);
      qc.clear();
    }
    navigate(to);
  };
}
