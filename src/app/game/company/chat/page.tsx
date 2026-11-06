import { redirect } from 'next/navigation';

/** 1.2.3.1: the company chat lives in the floating chat (channel „Компания“); old links open it there. */
export default function CompanyChatPage() {
  redirect('/game/company?chat=company');
}
