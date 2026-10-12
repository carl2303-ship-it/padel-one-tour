import { useState, useEffect } from 'react';
import { supabase, DailyScheduleEntry } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { X, Upload, Plus, Trash2, MapPin } from 'lucide-react';
import TimeInput24h from './TimeInput24h';
import { compressImage, formatFileSize } from '../lib/imageCompressor';
import { geocodeAddress } from '../lib/geocoding';

type CreateTournamentModalProps = {
  onClose: () => void;
  onSuccess: () => void;
  isIndependentOrganizer?: boolean;
};

type LadderCategoryFormRow = { name: string; min_level: string; max_level: string; max_teams: string };

export default function CreateTournamentModal({ onClose, onSuccess, isIndependentOrganizer }: CreateTournamentModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image_url: '',
    start_date: '',
    end_date: '',
    start_time: '09:00',
    end_time: '12:00',
    daily_start_time: '09:00',
    daily_end_time: '21:00',
    member_price: 0,
    non_member_price: 0,
    allow_club_payment: false,
    has_dinner_option: false,
    format: 'round_robin' as string,
    round_robin_type: 'teams' as string | null,
    ranking_tier: 'regular' as 'master' | 'regular' | 'social',
    gender: '' as string,
    challenge_limit: 5,
    swiss_rounds: 5,
  });
