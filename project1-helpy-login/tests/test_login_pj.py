# -*- coding: utf-8 -*-
"""로그인 자동화 테스트.

셀렉터와 페이지 조작은 src/pages/login_page.py의 LoginUiPage(Page Object)에 있고,
이 파일에는 '무엇을 검증하는지'만 남긴다.
"""
import logging
from urllib.parse import urlparse

import pytest

from src.pages.login_page import (
    MSG_INVALID_FORMAT,
    MSG_MISMATCH,
    MSG_PW_MIN_LENGTH,
    MSG_SERVER_ERROR,
    LoginUiPage,
    login,
)
from src.pages.main_page import MainPage

log = logging.getLogger(__name__)

# 이 파일의 모든 테스트에 login 마커 적용 (pytest -m login 으로 선택 실행)
pytestmark = pytest.mark.login


@pytest.fixture
def page(shared_driver, credentials):
    """한국어 로그인 페이지가 열린 상태의 Page Object (공유 브라우저 사용)."""
    return LoginUiPage(shared_driver, credentials["url"]).open()


@pytest.fixture
def login_ui_driver(driver, credentials):
    """LoginUiPage 흐름으로 로그인이 완료된 브라우저 (TID 23, 24 세션 유지 테스트용).
    conftest의 팀 공통 로그인 픽스처(setup_and_login)와 다른 파일 전용 픽스처라 이름을 구분한다."""
    login(driver, credentials["url"], credentials["email"], credentials["password"])
    return driver


# ══════════════════════════════════════════════════════════════
# 로그인 성공 / 세션 유지 / 로그아웃 (TID 41, 23, 24, 58, 59)
# ══════════════════════════════════════════════════════════════


def test_tid41_login_success(driver, credentials):
    """TID 41: 올바른 이메일/비밀번호 -> 로그인 성공 (프로필 아이콘 노출)"""
    login(driver, credentials["url"], credentials["email"], credentials["password"])
    assert MainPage(driver).profile_icon().is_displayed()


def test_tid23_back_button_keeps_login(login_ui_driver, credentials):
    """TID 23: 로그인 완료 후 뒤로가기 -> 로그인 상태 유지 (로그인 페이지로 안 감)"""
    login_ui_driver.back()
    # 앱 도메인 확인 포함 (PersonIcon은 로그인 페이지 아바타와 겹쳐 단독 판정 불가)
    icon = MainPage(login_ui_driver).wait_logged_in(credentials["url"])
    assert icon.is_displayed(), "[TID 23] 뒤로가기 후 프로필 아이콘이 사라짐 (로그인 풀림)"


def test_tid24_refresh_keeps_login(login_ui_driver, credentials):
    """TID 24: 로그인 완료 후 새로고침(F5) -> 로그인 상태 유지"""
    login_ui_driver.refresh()
    icon = MainPage(login_ui_driver).wait_logged_in(credentials["url"])
    log.info("새로고침 후 프로필 아이콘 표시: %s", icon.is_displayed())
    assert icon.is_displayed(), "[TID 24] 새로고침 후 프로필 아이콘이 사라짐 (로그인 풀림)"


def test_tid58_logout(driver, credentials):
    """TID 58: 프로필 -> 로그아웃 -> 로그인 페이지로 복귀"""
    login(driver, credentials["url"], credentials["email"], credentials["password"])
    MainPage(driver).logout()
    assert LoginUiPage(driver).password_input().is_displayed(), (
        "[TID 58] 로그아웃 후 로그인 페이지로 돌아오지 않음"
    )


def test_tid59_back_after_logout(driver, credentials):
    """TID 59: 로그아웃 완료 후 뒤로가기(alt+<-) -> 다시 로그인되지 않고 로그아웃 상태 유지"""
    login(driver, credentials["url"], credentials["email"], credentials["password"])
    MainPage(driver).logout()
    driver.back()
    # 미인증 상태이므로 뒤로가기해도 메인페이지가 아닌 로그인 화면이어야 함.
    # (로그아웃 후에는 아이디 저장된 로그인 페이지(signin/history)로 가므로
    #  signin-form 대신 비밀번호 입력창 존재로 로그인 화면 여부를 판단)
    pw_field = LoginUiPage(driver).wait_password_visible()
    # 재로그인 판정은 "메인페이지(앱 도메인)로 넘어갔는지"로 확인.
    # (PersonIcon은 아이디 저장된 로그인 페이지의 계정 아바타에도 쓰여 마커로 부적합)
    current_host = urlparse(driver.current_url).netloc
    app_host = urlparse(credentials["url"]).netloc
    log.info("뒤로가기 후 URL: %s", driver.current_url)
    assert "signin" in driver.current_url, (
        f"[TID 59] 뒤로가기 후 로그인 화면이 아님. URL: {driver.current_url}"
    )
    assert pw_field.is_displayed(), "[TID 59] 뒤로가기 후 로그인 입력창이 뜨지 않음"
    assert current_host != app_host, (
        "[TID 59] 뒤로가기 후 메인페이지로 재진입됨 (로그아웃 유지 실패)"
    )


# ══════════════════════════════════════════════════════════════
# 입력 누락 (TID 1~3) - 브라우저 기본 검증(required)이 빈 칸을 지목
# ══════════════════════════════════════════════════════════════


def test_tid1_empty_email(page, credentials):
    """TID 1: 이메일 누락 -> 브라우저가 이메일 칸을 지목"""
    page.password_input().send_keys(credentials["password"])
    page.login_button().click()

    field, msg = page.focused_validation()
    assert field == "loginId", f"[TID 1] 브라우저가 지목한 칸: {field} (기대: loginId)"
    assert msg != "", "[TID 1] 브라우저 안내문구가 비어 있음"


def test_tid2_empty_password(page, credentials):
    """TID 2: 비밀번호 누락 -> 브라우저가 비밀번호 칸을 지목"""
    page.email_input().send_keys(credentials["email"])
    page.login_button().click()

    field, msg = page.focused_validation()
    assert field == "password", f"[TID 2] 브라우저가 지목한 칸: {field} (기대: password)"
    assert msg != "", "[TID 2] 브라우저 안내문구가 비어 있음"


def test_tid3_empty_both(page, credentials):
    """TID 3: 전체 누락 -> 브라우저가 첫 빈 칸(이메일)을 먼저 지목"""
    page.login_button().click()

    field, msg = page.focused_validation()
    assert field == "loginId", f"[TID 3] 브라우저가 지목한 칸: {field} (기대: loginId)"
    assert msg != "", "[TID 3] 브라우저 안내문구가 비어 있음"


# ══════════════════════════════════════════════════════════════
# 이메일 형식 오류 (TID 4~9)
# ══════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "tid, email_value",
    [
        pytest.param(4, "tester _01@example.com", id="TID4-space-before-at"),
        pytest.param(5, "tester_01@ example.com", id="TID5-space-after-at"),
        pytest.param(7, "tester@team@example.com", id="TID7-multiple-at"),
        pytest.param(8, "tester_01example.com", id="TID8-missing-at"),
        pytest.param(9, "tester_한글@example.com", id="TID9-korean-char"),
    ],
)
def test_email_format_error(page, credentials, tid, email_value):
    """TID 4/5/7/8/9: 잘못된 이메일 형식 -> 브라우저(typeMismatch) 또는
    사이트 화면 문구("잘못된 이메일 형식입니다.") 중 하나가 로그인을 막아야 한다."""
    page.submit_login(email_value, credentials["password"])

    type_mismatch = page.email_type_mismatch()
    screen_msg = page.error_text_now()
    browser_msg = page.email_validation_message()
    log.info("[TID %s] typeMismatch=%s | 화면 문구: '%s' | 브라우저 말풍선: '%s'",
             tid, type_mismatch, screen_msg, browser_msg)

    assert type_mismatch is True or MSG_INVALID_FORMAT in screen_msg, (
        f"[TID {tid}] 입력 '{email_value}'가 차단되지 않음. "
        f"typeMismatch={type_mismatch}, 화면 문구='{screen_msg}'"
    )


def test_tid6_email_special_char(page, credentials):
    """TID 6: 이메일 특수문자(#) 포함 -> 화면에 형식 오류 문구 (브라우저 말풍선은 없음)"""
    msg = page.expect_error("tester#01@example.com", credentials["password"])
    browser_msg = page.email_validation_message()
    log.info("브라우저 말풍선: '%s' (특수문자는 말풍선 없음)", browser_msg)
    assert MSG_INVALID_FORMAT in msg, f"[TID 6] 실제 화면 문구: '{msg}'"


# ══════════════════════════════════════════════════════════════
# 로그인 실패 - 서버 검증 (TID 12~16)
# ══════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "tid, email, password, expected_msg",
    [
        # email/password가 None이면 정상 계정값(.env)을 사용한다.
        # 명세상 이메일 상한은 256자. 이를 초과한 257자를 넣어 경계 밖 입력을 검증한다.
        pytest.param(
            12, ("a" * 245) + "@example.com", None, MSG_SERVER_ERROR,
            id="TID12-email-over-256",
        ),
        pytest.param(
            13, "no_such_user_9999@example.com", None, MSG_MISMATCH,
            id="TID13-nonexistent-email",
        ),
        pytest.param(
            14, None, "definitely_wrong_pw_123", MSG_MISMATCH,
            id="TID14-wrong-password",
        ),
        pytest.param(
            15, None, "A" * 130, MSG_MISMATCH,
            id="TID15-password-too-long",
        ),
        pytest.param(
            16, None, "abc123", MSG_PW_MIN_LENGTH,
            id="TID16-password-too-short",
        ),
    ],
)
def test_login_server_validation(page, credentials, tid, email, password, expected_msg):
    """TID 12~16: 서버 검증 실패 입력 -> 각 상황에 맞는 안내 문구 노출"""
    email = email if email is not None else credentials["email"]
    password = password if password is not None else credentials["password"]
    msg = page.expect_error(email, password)
    assert expected_msg in msg, f"[TID {tid}] 실제 화면 문구: '{msg}'"


# ══════════════════════════════════════════════════════════════
# 페이지 진입 (TID 25~27)
# ══════════════════════════════════════════════════════════════


def test_tid25_page_load(page):
    """TID 25: 로그인 URL 접속 -> 정상 진입"""
    assert page.form().is_displayed()


def test_tid26_form_elements_load(page):
    """TID 26: 로그인 폼 구성요소(이메일/비밀번호/버튼) 정상 로드"""
    assert page.email_input().is_displayed(), "[TID 26] 이메일 입력창 없음"
    assert page.password_input().is_displayed(), "[TID 26] 비밀번호 입력창 없음"
    assert page.login_button().is_displayed(), "[TID 26] 로그인 버튼 없음"


def test_tid27_page_refresh(page):
    """TID 27: 새로고침(F5) 후에도 로그인 페이지 정상 로드"""
    form = page.refresh()
    assert form.is_displayed(), "[TID 27] 새로고침 후 로그인 폼이 뜨지 않음"


# ══════════════════════════════════════════════════════════════
# 입력창 UI (TID 30~33, 36)
# ══════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "tid, field, expected_placeholder",
    [
        pytest.param(30, "email", "이메일", id="TID30-email-placeholder"),
        pytest.param(32, "password", "비밀번호", id="TID32-password-placeholder"),
    ],
)
def test_input_placeholder(page, tid, field, expected_placeholder):
    """TID 30/32: 입력창 placeholder 문구 노출"""
    placeholder = getattr(page, f"{field}_placeholder")()
    log.info("%s placeholder: '%s'", field, placeholder)
    assert placeholder == expected_placeholder, (
        f"[TID {tid}] 실제 placeholder: '{placeholder}'"
    )


@pytest.mark.parametrize(
    "tid, field, expected_name",
    [
        pytest.param(31, "email", "loginId", id="TID31-email-click-focus"),
        pytest.param(33, "password", "password", id="TID33-password-click-focus"),
    ],
)
def test_input_click_focus(page, tid, field, expected_name):
    """TID 31/33: 입력창 클릭 -> 활성화(포커스)"""
    getattr(page, f"{field}_input")().click()
    name = page.focused_name()
    log.info("클릭 후 포커스된 칸: %s", name)
    assert name == expected_name, (
        f"[TID {tid}] 클릭 후 포커스된 칸: {name} (기대: {expected_name})"
    )


def test_tid36_password_masking_toggle(page):
    """TID 36: 마스킹 버튼 클릭 -> 비밀번호 표시/숨김 토글"""
    page.password_input().send_keys("toggle_test_123")
    assert page.password_type() == "password", "[TID 36] 초기 상태가 마스킹(password)이 아님"

    # 클릭 -> 표시(text)로 전환
    page.toggle_masking()
    page.wait_password_type("text")
    log.info("버튼 클릭 후 type: %s", page.password_type())

    # 재클릭 -> 다시 마스킹(password)으로 복귀
    page.toggle_masking()
    page.wait_password_type("password")
    log.info("재클릭 후 type: %s", page.password_type())


# ══════════════════════════════════════════════════════════════
# 링크 이동 (TID 38, 43)
# ══════════════════════════════════════════════════════════════


def test_tid38_forgot_password_navigation(page):
    """TID 38: 비밀번호 찾기 링크 클릭 -> 비밀번호 찾기 페이지 이동"""
    url = page.click_forgot_password()
    log.info("이동한 URL: %s", url)
    assert "recover/password" in url, f"[TID 38] 이동한 URL: {url}"


def test_tid43_signup_navigation(page):
    """TID 43: 회원가입 링크 클릭 -> 회원가입 페이지 이동"""
    url = page.click_signup()
    log.info("이동한 URL: %s", url)
    assert "signup" in url, f"[TID 43] 이동한 URL: {url}"
