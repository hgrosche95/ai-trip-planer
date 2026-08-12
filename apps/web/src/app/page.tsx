import ChatWindow from './chat-window';
import RequireAuth from './require-auth';

export default function Home() {
  return (
    <RequireAuth>
      <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
        <ChatWindow />
      </div>
    </RequireAuth>
  );
}