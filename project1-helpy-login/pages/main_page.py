# -*- coding: utf-8 -*-
"""로그인 후 메인 페이지 Page Object (프로필 아이콘 / 로그아웃).

login_ui_page.py(팀 저장소의 src/pages/login_page.py)의 LoginUiPage와 짝을 이루지만, 순환 참조를 피하기 위해
필요한 상수(비밀번호 입력창 셀렉터)를 자체 보유하고 login_page를 import하지 않는다.
"""
from urllib.parse import urlparse

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from src.config.config import WAIT_TIME


class MainPage:
    """로그인 후 메인 페이지 (프로필 아이콘 / 로그아웃)."""

    # 로그인 성공 마커: 메인페이지 사이드바의 프로필 아바타
    PROFILE_ICON = (By.CSS_SELECTOR, "[data-testid='PersonIcon']")
    # 프로필 아바타를 감싼 클릭 가능한 버튼 (드롭다운 열기용)
    PROFILE_BUTTON = (By.XPATH, "//*[@data-testid='PersonIcon']/ancestor::button")
    # 프로필 드롭다운의 로그아웃 메뉴 - 언어 무관 아이콘 속성 기반
    # (텍스트 '로그아웃'은 영문 페이지에서 바뀌므로 사용하지 않음.
    #  svg는 JS click()이 없어서 아이콘을 감싼 메뉴 항목(div)을 클릭 대상으로 지정)
    LOGOUT_MENU = (
        By.XPATH,
        "//*[@data-icon='arrow-right-from-bracket']"
        "/ancestor::*[contains(@class, 'MuiListItemButton-root')][1]",
    )
    # 로그아웃 완료(로그인 화면 복귀) 판정용 비밀번호 입력창
    PASSWORD_INPUT = (By.CSS_SELECTOR, "input[name='password']")

    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(driver, WAIT_TIME)

    def wait_logged_in(self, app_url=None):
        """로그인 완료 마커(프로필 아이콘) 등장까지 대기, 아이콘 요소 반환.
        app_url을 주면 현재 도메인이 앱 도메인인지도 함께 확인한다.
        (PersonIcon은 아이디 저장된 로그인 페이지의 아바타에도 떠서 단독 판정은 불충분)"""
        icon = self.wait.until(EC.presence_of_element_located(self.PROFILE_ICON))
        if app_url is not None:
            app_host = urlparse(app_url).netloc
            self.wait.until(lambda d: urlparse(d.current_url).netloc == app_host)
        return icon

    def profile_icon(self):
        return self.driver.find_element(*self.PROFILE_ICON)

    def logout(self):
        """프로필 드롭다운에서 로그아웃 클릭 후 로그인 페이지 복귀까지 대기.
        (MUI 오버레이 간섭을 피해 JS 클릭 사용)"""
        avatar = self.wait.until(EC.element_to_be_clickable(self.PROFILE_BUTTON))
        self.driver.execute_script("arguments[0].click();", avatar)
        menu = self.wait.until(EC.presence_of_element_located(self.LOGOUT_MENU))
        self.driver.execute_script("arguments[0].click();", menu)
        self.wait.until(EC.visibility_of_element_located(self.PASSWORD_INPUT))
