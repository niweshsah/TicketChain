export const roles = {
  identity: [
    'tc_account',
    'tc_session',
    'tc_oauthidentity',
    'tc_oauthattempt',
    'tc_walletchallenge',
    'tc_ratebucket',
  ],
  booking: [
    'tc_account',
    'tc_listing',
    'tc_tier',
    'tc_inventoryunit',
    'tc_purchase',
    'tc_purchaseitem',
    'tc_allocation',
    'tc_admissionticket',
    'tc_provideroperation',
    'tc_claim',
    'tc_job',
    'tc_ratebucket',
  ],
  payments: [
    'tc_purchase',
    'tc_provideroperation',
    'tc_webhookevent',
    'tc_job',
    'tc_ratebucket',
  ],
  catalog: ['tc_catalogevent', 'tc_ratebucket'],
};
export const infrastructure = ['tc_outbox', 'tc_inbox', 'tc_aggregateversion'];
