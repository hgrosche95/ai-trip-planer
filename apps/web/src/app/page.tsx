import ChatWindow from './chat-window';
import TripGlobe from '@/components/trip-globe';

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-48 -bottom-48 size-[38rem] opacity-40 sm:-right-32 sm:opacity-90"
      >
        <TripGlobe />
      </div>
      <div className="relative flex flex-1 flex-col">
        <ChatWindow />
      </div>
    </div>
  );
}
