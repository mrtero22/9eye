// The Scheduling page (scheduling-page.md): the order list, one order, a new order.

import { useParams } from 'react-router';
import { NewOrder } from './NewOrder';
import { OrderList } from './OrderList';
import { OrderPage } from './OrderPage';

export function SchedulingPage() {
  const { orderId } = useParams();
  if (orderId === 'new') return <NewOrder />;
  if (orderId) return <OrderPage key={orderId} orderId={orderId} />;
  return <OrderList />;
}
