from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from wodana_intelligence.api.routes.providers import PortalOtpDelivery, deliver_portal_otp
from wodana_intelligence.worker.accounting import reconcile_once


def request(token='internal-test-token'):
    return Request({'type':'http','headers':[(b'x-wodana-internal-token', token.encode())]})


@pytest.mark.asyncio
async def test_otp_requires_internal_auth_and_approved_template():
    payload=PortalOtpDelivery(workspaceId=uuid4(),challengeId=uuid4(),phone='+971501234567',code='029145')
    service=SimpleNamespace(settings=SimpleNamespace(business_core_internal_token='internal-test-token',portal_otp_template='',portal_otp_language='en_US'),send_whatsapp_notification=AsyncMock())
    with pytest.raises(HTTPException) as denied:
        await deliver_portal_otp(payload,request('wrong'),service)
    assert denied.value.status_code==401
    with pytest.raises(HTTPException) as missing:
        await deliver_portal_otp(payload,request(),service)
    assert missing.value.status_code==503
    service.send_whatsapp_notification.assert_not_called()


@pytest.mark.asyncio
async def test_otp_uses_same_code_in_body_and_copy_button_with_stable_challenge():
    payload=PortalOtpDelivery(workspaceId=uuid4(),challengeId=uuid4(),phone='+971501234567',code='029145')
    service=SimpleNamespace(settings=SimpleNamespace(business_core_internal_token='internal-test-token',portal_otp_template='client_login',portal_otp_language='en_US'),send_whatsapp_notification=AsyncMock(return_value={'id':'wamid.test','status':'accepted'}))
    result=await deliver_portal_otp(payload,request(),service)
    workspace,operation=service.send_whatsapp_notification.call_args.args
    assert workspace==str(payload.workspaceId)
    assert operation.idempotency_key==payload.challengeId
    assert operation.payload['bodyParameters']==['029145']
    assert operation.payload['urlParameter']=='029145'
    assert '029145' not in str(result)


@pytest.mark.asyncio
async def test_reconciliation_reads_exact_linked_connection_and_posts_provider_snapshot():
    job={'id':'job','leaseToken':'lease','workspaceId':'w','provider':'quickbooks','connectionId':'selected-company','invoiceId':'invoice'}
    core=SimpleNamespace(_internal_request=AsyncMock(side_effect=[{'jobs':[job]},{'reconciled':True}]))
    providers=SimpleNamespace(runtime_internal=AsyncMock(return_value=({},'credential')),client=SimpleNamespace(invoice=AsyncMock(return_value={'id':'invoice','total':100,'balance':0,'currency':'AED','status':'paid'})))
    assert await reconcile_once(core,providers)==1
    providers.runtime_internal.assert_awaited_once_with('w','quickbooks','selected-company')
    providers.client.invoice.assert_awaited_once_with('credential','invoice')
    posted=core._internal_request.call_args.kwargs['json']
    assert posted['leaseToken']=='lease'
    assert posted['invoice']['balance']==0


@pytest.mark.asyncio
async def test_failed_refresh_never_fabricates_zero_balance_or_leaks_provider_exception():
    core=SimpleNamespace(_internal_request=AsyncMock(side_effect=[{'jobs':[{'id':'job','leaseToken':'lease','workspaceId':'w','provider':'zoho_books','connectionId':'c','invoiceId':'i'}]},{'reconciled':False}]))
    providers=SimpleNamespace(runtime_internal=AsyncMock(side_effect=RuntimeError('secret-credential-in-error')))
    assert await reconcile_once(core,providers)==1
    posted=core._internal_request.call_args.kwargs['json']
    assert 'invoice' not in posted
    assert 'secret-credential' not in str(posted)
    assert posted['error']
